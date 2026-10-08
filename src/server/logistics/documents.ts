import type { Market, Order, OrderLine, PrismaClient } from "@prisma/client";
import { company } from "@/config/app";
import { countryName } from "@/lib/countries";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/zoned";
import { sheet } from "@/server/documents/pdf-kit";
import { DELIVERY_STATUS_LABEL, type deliveryWithOrder } from "./deliveries";
import { logisticsSettings } from "./landed";

/**
 * Papers that travel with the goods: the delivery note (what is in the
 * box, no prices, signed on arrival) and the commercial invoice for
 * customs (tariff codes, origin, weights and values). Neither names our
 * suppliers.
 */

const where = (o: Pick<Order, "fulfilment" | "addressLine1" | "addressLine2" | "city" | "postalCode" | "collectionText">) => (o.fulfilment === "DELIVERY" ? [o.addressLine1, o.addressLine2, o.city, o.postalCode].filter(Boolean).join(", ") : `Collected from ${o.collectionText.split("\n")[0] ?? ""}`);

type DeliveryForNote = NonNullable<Awaited<ReturnType<typeof deliveryWithOrder>>>;

export async function deliveryNotePdf(d: DeliveryForNote, serials: Map<string, string[]>, ctx: { appUrl: string; legalName: string; token?: string }): Promise<Uint8Array> {
  const o = d.order;
  const s = await sheet("Delivery note", d.number);
  const date = (x: Date) => formatDate(x, o.market.locale, o.market.timeZone);
  s.heading([ctx.legalName, company.domain, d.warehouse ? `${d.warehouse.name}${d.warehouse.address ? `, ${d.warehouse.address.split("\n").join(", ")}` : ""}` : ""], [`Order: ${o.number}`, `Date: ${date(d.dispatchedAt ?? d.createdAt)}`, `Status: ${DELIVERY_STATUS_LABEL[d.status]}`, [d.carrier, d.reference].filter(Boolean).join(" ")].filter(Boolean));
  s.party(o.fulfilment === "DELIVERY" ? "Deliver to" : "Collected by", [o.name, o.phone].filter(Boolean).join(", "), [o.customerReference ? `Your reference: ${o.customerReference}` : "", where(o)]);
  const lines = [...d.lines].sort((a, b) => a.orderLine.sortOrder - b.orderLine.sortOrder);
  s.lines(lines.map((l, i) => ({ n: String(i + 1), description: l.orderLine.description, sub: [l.orderLine.mpn ? `Part ${l.orderLine.mpn}` : "", (serials.get(l.orderLineId) ?? []).length ? `Serials: ${serials.get(l.orderLineId)!.join(", ")}` : ""].filter(Boolean).join(". "), quantity: String(l.quantity), unit: "", total: "" })), "");
  const units = lines.reduce((n, l) => n + l.quantity, 0);
  s.totals([["Items", String(units)]]);
  if (d.status === "DELIVERED") s.block("Received", `Signed for by ${d.receivedBy}${d.deliveredAt ? ` on ${date(d.deliveredAt)}` : ""}.`);
  else s.block("Received in good order", "Name: ____________________________   Signature: ____________________   Date: ______________\nCheck the boxes before signing. Note any damage here and tell us within 2 working days.");
  s.button("See the order online", `${ctx.appUrl}/orders/${encodeURIComponent(o.number)}${ctx.token ? `?t=${encodeURIComponent(ctx.token)}` : ""}`);
  return s.finish();
}

/** What customs needs for each line: tariff code, where it was made or shipped from, and its weight. */
export async function customsLines(db: PrismaClient, lines: Pick<OrderLine, "id" | "productId">[]) {
  const products = await db.product.findMany({ where: { id: { in: lines.map((l) => l.productId).filter((p): p is string => Boolean(p)) } }, select: { id: true, weightGrams: true, category: { select: { hsCode: true, parent: { select: { hsCode: true } } } } } });
  const bought = await db.purchaseOrderLine.findMany({ where: { orderLineId: { in: lines.map((l) => l.id) }, purchaseOrder: { status: { not: "CANCELLED" } } }, select: { orderLineId: true, purchaseOrder: { select: { supplier: { select: { country: true } } } } } });
  return new Map(
    lines.map((l) => {
      const p = products.find((x) => x.id === l.productId);
      const origins = [...new Set(bought.filter((b) => b.orderLineId === l.id).map((b) => b.purchaseOrder.supplier.country).filter(Boolean))];
      return [l.id, { hsCode: p ? p.category.hsCode || p.category.parent?.hsCode || "" : "", origin: origins.join(", "), weightGrams: p?.weightGrams ?? null }] as const;
    }),
  );
}

export async function commercialInvoicePdf(db: PrismaClient, o: Order & { lines: OrderLine[]; market: Pick<Market, "locale" | "timeZone" | "supportEmail" | "name"> }, ctx: { legalName: string }): Promise<Uint8Array> {
  const [settings, customs] = await Promise.all([logisticsSettings(db), customsLines(db, o.lines)]);
  const s = await sheet("Commercial invoice", o.number);
  const { locale, timeZone } = o.market;
  const money = (n: bigint) => formatMoney({ amountMinor: n, currency: o.currency }, locale);
  s.heading([ctx.legalName, company.domain, o.market.supportEmail ?? "", `Ships from ${countryName(settings.homeCountry, locale)}`], [`Date: ${formatDate(o.fulfilledAt ?? new Date(), locale, timeZone)}`, `Incoterm: ${settings.incoterm}`, `Currency: ${o.currency}`]);
  s.party("Consignee", [o.name, o.phone].filter(Boolean).join(", "), [o.customerReference ? `Buyer reference: ${o.customerReference}` : "", `${where(o)}${o.fulfilment === "DELIVERY" ? `, ${o.market.name}` : ""}`]);
  let grams = 0;
  s.lines(
    o.lines.map((l, i) => {
      const c = customs.get(l.id)!;
      if (c.weightGrams) grams += c.weightGrams * l.quantity;
      const sub = [l.mpn ? `Part ${l.mpn}` : "", c.hsCode ? `HS ${c.hsCode}` : "HS code to be confirmed", c.origin ? `Origin ${c.origin}` : "", c.weightGrams ? `${((c.weightGrams * l.quantity) / 1000).toFixed(2)} kg` : ""].filter(Boolean).join(". ");
      return { n: String(i + 1), description: l.description, sub, quantity: String(l.quantity), unit: money(l.unitPriceMinor), total: money(l.lineTotalMinor) };
    }),
  );
  s.totals([...(o.deliveryMinor > 0n ? ([["Freight", money(o.deliveryMinor)]] as [string, string][]) : []), [o.pricesIncludeTax ? `Includes ${o.taxName}` : `${o.taxName} ${o.taxRateBps / 100}%`, money(o.taxMinor)], ["Invoice value", money(o.totalMinor)]]);
  if (grams) s.block("Gross weight", `${(grams / 1000).toFixed(2)} kg, from our product records.`);
  s.block("Declaration", `We declare that the information on this invoice is true and correct, and that the goods are as described. Terms of delivery: ${settings.incoterm}.`);
  return s.finish();
}
