import type { PrismaClient } from "@prisma/client";
import { OPEN_STATUSES } from "@/server/quotes/common";
import { customerInvoices } from "./invoices";
import { scopeWhere, type PortalViewer } from "./scope";

/**
 * Deliveries, tracking and the account at a glance. Staff notes, who
 * recorded each step and anything about suppliers stay out.
 */

type Who = Pick<PortalViewer, "userId" | "organisationId">;

/** Deliveries that have left us, newest first. */
export async function customerDeliveries(db: Pick<PrismaClient, "delivery">, v: Who) {
  return db.delivery.findMany({
    where: { order: scopeWhere(v), status: { not: "PREPARED" } },
    orderBy: { dispatchedAt: "desc" },
    take: 200,
    select: {
      id: true,
      number: true,
      status: true,
      carrier: true,
      reference: true,
      dispatchedAt: true,
      deliveredAt: true,
      receivedBy: true,
      podFilename: true,
      order: { select: { number: true, fulfilment: true, market: { select: { locale: true, timeZone: true } } } },
      lines: { select: { quantity: true, orderLine: { select: { description: true } } } },
    },
  });
}

/** Items still on their way to the customer, with where each one is. */
export async function itemsOnTheWay(db: Pick<PrismaClient, "orderLine">, v: Who) {
  return db.orderLine.findMany({
    where: { order: { ...scopeWhere(v), status: { in: ["PAID", "ON_ACCOUNT", "FULFILLED"] } }, tracking: { not: null, notIn: ["DELIVERED"] } },
    orderBy: [{ order: { createdAt: "desc" } }, { sortOrder: "asc" }],
    take: 300,
    select: { id: true, description: true, quantity: true, tracking: true, order: { select: { number: true, market: { select: { locale: true, timeZone: true } } } }, trackingEvents: { orderBy: { at: "desc" }, take: 1, select: { at: true } } },
  });
}

/** Counts and amounts for the account's first page. */
export async function portalSummary(db: Pick<PrismaClient, "quote" | "order" | "orderLine" | "invoice" | "returnRequest">, v: Who, now = new Date()) {
  const where = scopeWhere(v);
  const [ready, preparing, inProgress, toPay, onTheWay, returns, invoices] = await Promise.all([
    db.quote.count({ where: { ...where, status: "SENT" } }),
    db.quote.count({ where: { ...where, status: { in: OPEN_STATUSES } } }),
    db.order.count({ where: { ...where, status: { in: ["PAID", "ON_ACCOUNT"] } } }),
    db.order.count({ where: { ...where, status: "AWAITING_PAYMENT" } }),
    db.orderLine.count({ where: { order: { ...where, status: { in: ["PAID", "ON_ACCOUNT", "FULFILLED"] } }, tracking: { not: null, notIn: ["DELIVERED"] } } }),
    db.returnRequest.count({ where: { ...where, status: { in: ["REQUESTED", "APPROVED", "RECEIVED"] } } }),
    customerInvoices(db, v, now, { open: true }),
  ]);
  const owed = new Map<string, { owed: bigint; overdue: bigint; locale: string }>();
  for (const i of invoices) {
    const o = owed.get(i.currency) ?? { owed: 0n, overdue: 0n, locale: i.order.market.locale };
    o.owed += i.outstanding;
    if (i.state === "OVERDUE") o.overdue += i.outstanding;
    owed.set(i.currency, o);
  }
  return { quotes: { ready, preparing }, orders: { inProgress, toPay }, onTheWay, returns, owed: [...owed].map(([currency, o]) => ({ currency, ...o })), openInvoices: invoices.length };
}
