import type { PrismaClient } from "@prisma/client";
import { share } from "@/lib/accounting-export";
import { average, inBase, marginBps, median, rateAt, rateBook } from "@/lib/reports";
import { pricingSettings } from "@/server/pricing/rates";
import { quoteReport } from "@/server/quotes/report";
import { ORDER_STATUS_LABEL } from "@/server/shop/orders";

/**
 * The finance reports in /admin/reports, for a period. Sales are orders
 * placed in the period that went ahead (paid, on account or sent), before
 * tax, in the base currency at the rate in use the day each was placed.
 * Cost is the landed cost recorded on each line when it was sold: the
 * supplier's price with freight, duty and the supplier's landed cost
 * share. Delivery charged to customers has no cost against it. Credit
 * notes are shown on their own and not taken off margin.
 */

export interface Totals {
  label: string;
  orders: number;
  /** Before tax, in base. */
  sales: bigint;
  /** Sales on lines with a recorded cost. */
  costedSales: bigint;
  cost: bigint;
  margin: bigint;
  /** Margin over costed sales; null with none. */
  marginBps: number | null;
}

const blank = (label: string): Totals & { ids: Set<string> } => ({
  label,
  orders: 0,
  sales: 0n,
  costedSales: 0n,
  cost: 0n,
  margin: 0n,
  marginBps: null,
  ids: new Set(),
});

function finish(rows: Map<string, Totals & { ids: Set<string> }>): Totals[] {
  return [...rows.values()]
    .map(({ ids, ...t }) => ({
      ...t,
      orders: ids.size,
      margin: t.costedSales - t.cost,
      marginBps: marginBps(t.costedSales, t.cost),
    }))
    .sort((a, b) => (b.sales > a.sales ? 1 : b.sales < a.sales ? -1 : a.label.localeCompare(b.label)));
}

export interface OrderMargin {
  id: string;
  number: string;
  createdAt: Date;
  customer: string;
  sales: bigint;
  cost: bigint;
  costed: boolean;
  marginBps: number | null;
}

export interface SupplierPerformance {
  name: string;
  purchaseOrders: number;
  /** Median hours from sending a purchase order to the supplier confirming it. */
  confirmHours: number | null;
  /** Median days from sending to the goods leaving the supplier. */
  shipDays: number | null;
  /** Shipped by the date they gave, out of those with a date that have shipped. */
  onTime: number;
  late: number;
  priceRequests: number;
  answered: number;
  /** Median hours to answer a request for price. */
  answerHours: number | null;
}

export async function financeReport(db: PrismaClient, from: Date, to: Date) {
  const { baseCurrency: base } = await pricingSettings(db);
  const [orders, rates, types, credits] = await Promise.all([
    db.order.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        status: { in: ["PAID", "ON_ACCOUNT", "FULFILLED"] },
      },
      select: {
        id: true,
        number: true,
        createdAt: true,
        currency: true,
        name: true,
        customerType: true,
        pricesIncludeTax: true,
        deliveryMinor: true,
        taxMinor: true,
        totalMinor: true,
        organisationId: true,
        email: true,
        organisation: { select: { name: true } },
        market: { select: { name: true } },
        lines: {
          select: {
            lineTotalMinor: true,
            quantity: true,
            unitCostBaseMinor: true,
            fromStock: true,
            supplier: { select: { name: true } },
            poLines: {
              where: { purchaseOrder: { status: { not: "CANCELLED" } } },
              take: 1,
              select: {
                purchaseOrder: {
                  select: { supplier: { select: { name: true } } },
                },
              },
            },
            product: {
              select: {
                category: {
                  select: { name: true, parent: { select: { name: true } } },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.exchangeRate.findMany({
      where: { base, heldBack: null, fetchedAt: { lte: to } },
      select: { quote: true, rate: true, fetchedAt: true },
    }),
    db.customerType.findMany({ select: { code: true, name: true } }),
    db.creditNote.findMany({
      where: { issuedAt: { gte: from, lte: to } },
      select: {
        orderId: true,
        totalMinor: true,
        taxMinor: true,
        currency: true,
        issuedAt: true,
        order: { select: { market: { select: { name: true } } } },
      },
    }),
  ]);
  const book = rateBook(rates);
  const typeName = new Map(types.map((t) => [t.code, t.name]));
  const markets = new Map<string, Totals & { ids: Set<string> }>();
  const categories = new Map<string, Totals & { ids: Set<string> }>();
  const suppliers = new Map<string, Totals & { ids: Set<string> }>();
  const customerTypes = new Map<string, Totals & { ids: Set<string> }>();
  const customers = new Map<string, Totals & { ids: Set<string> }>();
  const total = blank("All sales");
  const byOrder: OrderMargin[] = [];
  const unconverted = new Set<string>();

  const add = (map: Map<string, Totals & { ids: Set<string> }> | null, key: string, orderId: string, sales: bigint, cost: bigint | null) => {
    const row = map ? (map.get(key) ?? blank(key)) : total;
    if (map) map.set(key, row);
    row.ids.add(orderId);
    row.sales += sales;
    if (cost !== null) {
      row.costedSales += sales;
      row.cost += cost;
    }
  };

  for (const o of orders) {
    const rate = rateAt(book, o.currency, o.createdAt);
    const conv = (n: bigint) => inBase(n, o.currency, base, rate);
    if (o.currency !== base && !rate) {
      unconverted.add(o.currency);
      continue;
    }
    // Each line and the delivery before tax, with the order's tax shared out in proportion.
    const amounts = [...o.lines.map((l) => l.lineTotalMinor), o.deliveryMinor];
    const taxes = o.pricesIncludeTax ? share(o.taxMinor, amounts) : amounts.map(() => 0n);
    const customer = o.organisation?.name ?? `${o.name} (${o.email})`;
    let sales = 0n;
    let cost = 0n;
    let costed = true;
    o.lines.forEach((l, i) => {
      const net = conv(amounts[i] - taxes[i])!;
      const c = l.unitCostBaseMinor === null ? null : l.unitCostBaseMinor * BigInt(l.quantity);
      const cat = l.product?.category;
      add(categories, cat ? (cat.parent ? `${cat.parent.name} / ${cat.name}` : cat.name) : "Not in the catalogue", o.id, net, c);
      // Who it was bought from: the purchase order's supplier, else the one quoted, else our stock.
      add(suppliers, l.poLines[0]?.purchaseOrder.supplier.name ?? l.supplier?.name ?? (l.fromStock ? "From our stock" : "Not yet bought"), o.id, net, c);
      add(markets, o.market.name, o.id, net, c);
      add(customerTypes, typeName.get(o.customerType) ?? o.customerType, o.id, net, c);
      add(customers, customer, o.id, net, c);
      add(null, "", o.id, net, c);
      sales += net;
      if (c === null) costed = false;
      else cost += c;
    });
    const delivery = conv(amounts[amounts.length - 1] - taxes[taxes.length - 1])!;
    if (delivery) {
      add(categories, "Delivery charged", o.id, delivery, 0n);
      add(markets, o.market.name, o.id, delivery, 0n);
      add(customerTypes, typeName.get(o.customerType) ?? o.customerType, o.id, delivery, 0n);
      add(customers, customer, o.id, delivery, 0n);
      add(null, "", o.id, delivery, 0n);
      sales += delivery;
    }
    byOrder.push({
      id: o.id,
      number: o.number,
      createdAt: o.createdAt,
      customer,
      sales,
      cost,
      costed,
      marginBps: costed ? marginBps(sales, cost) : null,
    });
  }

  const creditedByMarket = new Map<string, bigint>();
  let credited = 0n;
  for (const c of credits) {
    const n = inBase(c.totalMinor - c.taxMinor, c.currency, base, rateAt(book, c.currency, c.issuedAt));
    if (n === null) {
      unconverted.add(c.currency);
      continue;
    }
    credited += n;
    creditedByMarket.set(c.order.market.name, (creditedByMarket.get(c.order.market.name) ?? 0n) + n);
  }

  const [quotes, supplierRows, stock, open] = await Promise.all([quoteSection(db, from, to), supplierPerformance(db, from, to), stockValue(db, base), openOrders(db, base, book)]);
  return {
    base,
    from,
    to,
    total: finish(new Map([["", total]]))[0],
    credited,
    byMarket: finish(markets).map((r) => ({
      ...r,
      credited: creditedByMarket.get(r.label) ?? 0n,
    })),
    byCategory: finish(categories),
    bySupplier: finish(suppliers),
    byCustomerType: finish(customerTypes),
    topCustomers: finish(customers).slice(0, 15),
    byOrder: byOrder.slice(0, 100),
    unconverted: [...unconverted].sort(),
    quotes,
    suppliers: supplierRows,
    stock,
    open,
  };
}

export type FinanceReport = Awaited<ReturnType<typeof financeReport>>;

async function quoteSection(db: PrismaClient, from: Date, to: Date) {
  const r = await quoteReport(db, from, to);
  const sent = await db.quote.findMany({
    where: { createdAt: { gte: from, lte: to }, sentAt: { not: null } },
    select: { createdAt: true, sentAt: true },
  });
  const times = sent.map((q) => q.sentAt!.getTime() - q.createdAt.getTime());
  return {
    total: r.total,
    byType: r.byType,
    medianMs: median(times),
    averageMs: average(times),
  };
}

const hours = (ms: number | null) => (ms === null ? null : Math.round(ms / 3_600_000));

async function supplierPerformance(db: PrismaClient, from: Date, to: Date): Promise<SupplierPerformance[]> {
  const [pos, rfqs] = await Promise.all([
    db.purchaseOrder.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        status: { not: "CANCELLED" },
      },
      select: {
        sentAt: true,
        confirmedAt: true,
        shippedAt: true,
        expectedShipDate: true,
        supplier: { select: { name: true } },
        lines: { select: { shipDate: true } },
      },
    }),
    db.supplierPriceRequest.findMany({
      where: { createdAt: { gte: from, lte: to }, status: { not: "CLOSED" } },
      select: {
        sentAt: true,
        createdAt: true,
        respondedAt: true,
        supplier: { select: { name: true } },
      },
    }),
  ]);
  const names = [...new Set([...pos.map((p) => p.supplier.name), ...rfqs.map((r) => r.supplier.name)])];
  return names
    .map((name) => {
      const mine = pos.filter((p) => p.supplier.name === name);
      const asked = rfqs.filter((r) => r.supplier.name === name);
      const confirm = mine.filter((p) => p.sentAt && p.confirmedAt).map((p) => p.confirmedAt!.getTime() - p.sentAt!.getTime());
      const ship = mine.filter((p) => p.sentAt && p.shippedAt).map((p) => p.shippedAt!.getTime() - p.sentAt!.getTime());
      let onTime = 0;
      let late = 0;
      for (const p of mine) {
        // The date they gave: the order's, or the latest of its lines'.
        const dates = p.lines.map((l) => l.shipDate).filter((d): d is Date => Boolean(d));
        const promised = p.expectedShipDate ?? (dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null);
        if (!promised || !p.shippedAt) continue;
        // A day's grace: dates are given as days, times are exact.
        if (p.shippedAt.getTime() <= promised.getTime() + 86_400_000) onTime += 1;
        else late += 1;
      }
      const answered = asked.filter((r) => r.respondedAt);
      const answerMs = answered.map((r) => r.respondedAt!.getTime() - (r.sentAt ?? r.createdAt).getTime());
      const shipMedian = median(ship);
      return {
        name,
        purchaseOrders: mine.length,
        confirmHours: hours(median(confirm)),
        shipDays: shipMedian === null ? null : Math.round(shipMedian / 86_400_000),
        onTime,
        late,
        priceRequests: asked.length,
        answered: answered.length,
        answerHours: hours(median(answerMs)),
      };
    })
    .sort((a, b) => b.purchaseOrders - a.purchaseOrders || b.priceRequests - a.priceRequests || a.name.localeCompare(b.name));
}

/** What we hold now, at each product's landed cost. */
async function stockValue(db: PrismaClient, base: string) {
  const levels = await db.stockLevel.findMany({
    where: { onHand: { gt: 0 } },
    select: {
      onHand: true,
      allocated: true,
      warehouse: { select: { name: true } },
      product: {
        select: { landedCostMinor: true, category: { select: { name: true } } },
      },
    },
  });
  const byWarehouse = new Map<string, { label: string; units: number; value: bigint; uncosted: number }>();
  const byCategory = new Map<string, { label: string; units: number; value: bigint; uncosted: number }>();
  const total = { label: "All stock", units: 0, value: 0n, uncosted: 0 };
  for (const l of levels) {
    const v = l.product.landedCostMinor === null ? null : l.product.landedCostMinor * BigInt(l.onHand);
    for (const [map, key] of [
      [byWarehouse, l.warehouse.name],
      [byCategory, l.product.category.name],
    ] as const) {
      const row = map.get(key) ?? {
        label: key,
        units: 0,
        value: 0n,
        uncosted: 0,
      };
      row.units += l.onHand;
      if (v === null) row.uncosted += l.onHand;
      else row.value += v;
      map.set(key, row);
    }
    total.units += l.onHand;
    if (v === null) total.uncosted += l.onHand;
    else total.value += v;
  }
  const sort = (m: Map<string, { label: string; units: number; value: bigint; uncosted: number }>) => [...m.values()].sort((a, b) => (b.value > a.value ? 1 : b.value < a.value ? -1 : a.label.localeCompare(b.label)));
  return {
    base,
    total,
    byWarehouse: sort(byWarehouse),
    byCategory: sort(byCategory),
  };
}

/** Orders not yet sent, whenever placed, by state. */
async function openOrders(db: PrismaClient, base: string, book: ReturnType<typeof rateBook>) {
  const rows = await db.order.findMany({
    where: { status: { in: ["AWAITING_PAYMENT", "PAID", "ON_ACCOUNT"] } },
    select: {
      status: true,
      currency: true,
      totalMinor: true,
      taxMinor: true,
      createdAt: true,
    },
  });
  const now = Date.now();
  return (["AWAITING_PAYMENT", "PAID", "ON_ACCOUNT"] as const).map((status) => {
    const list = rows.filter((r) => r.status === status);
    const value = list.reduce((s, r) => s + (inBase(r.totalMinor - r.taxMinor, r.currency, base, rateAt(book, r.currency, r.createdAt)) ?? 0n), 0n);
    const oldest = list.reduce<Date | null>((d, r) => (!d || r.createdAt < d ? r.createdAt : d), null);
    return {
      status,
      label: ORDER_STATUS_LABEL[status],
      count: list.length,
      value,
      oldestDays: oldest ? Math.floor((now - oldest.getTime()) / 86_400_000) : null,
    };
  });
}
