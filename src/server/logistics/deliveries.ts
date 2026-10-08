import type { Prisma, PrismaClient } from "@prisma/client";
import { audit, staffAudit } from "@/server/audit";
import { queueEmail } from "@/server/email/outbox";
import { DomainError } from "@/server/errors";
import { syncUnits } from "@/server/aftersales/units";
import { issueInvoice } from "@/server/portal/invoices";
import { orderEmailPayload, TO_SEND, type OrderDeps } from "@/server/shop/orders";
import { assertStaffCan, type StaffActor } from "@/server/staff/access";
import { defaultWarehouse, issueForDelivery } from "./stock";
import { advanceLines } from "./tracking";

/**
 * Deliveries: what leaves our warehouse for a customer, with a delivery
 * note to go with it and proof of delivery once it is signed for. An
 * order can go in several deliveries; once everything has left, the
 * order is sent and the customer told.
 */

type Tx = Prisma.TransactionClient;

export const DELIVERY_STATUS_LABEL = { PREPARED: "Being packed", DISPATCHED: "Dispatched", DELIVERED: "Delivered" } as const;
export const DELIVERY_STATUS_TONE = { PREPARED: "neutral", DISPATCHED: "highlight", DELIVERED: "positive" } as const;

export const MAX_POD_BYTES = 10 * 1024 * 1024;

/** How many of each line are already in a delivery. */
async function inDeliveries(tx: Tx | Pick<PrismaClient, "deliveryLine">, orderId: string, onlyLeft = false) {
  const rows = await tx.deliveryLine.groupBy({ by: ["orderLineId"], where: { delivery: { orderId, ...(onlyLeft ? { status: { in: ["DISPATCHED", "DELIVERED"] } } : {}) } }, _sum: { quantity: true } });
  return new Map(rows.map((r) => [r.orderLineId, r._sum.quantity ?? 0]));
}

/** Each line of an order with how many are still to go in a delivery. */
export async function linesToDeliver(db: Pick<PrismaClient, "orderLine" | "deliveryLine">, orderId: string) {
  const [lines, taken] = await Promise.all([db.orderLine.findMany({ where: { orderId }, orderBy: { sortOrder: "asc" }, select: { id: true, description: true, mpn: true, quantity: true, tracking: true, fromStock: true } }), inDeliveries(db, orderId)]);
  return lines.map((l) => ({ ...l, toDeliver: Math.max(0, l.quantity - (taken.get(l.id) ?? 0)) }));
}

export interface PrepareInput {
  /** Order line id to quantity. Missing lines are not in this delivery. */
  quantities: Record<string, string>;
  carrier: string;
  reference: string;
}

/** Packs a delivery: which lines and how many. Its delivery note can be printed straight away. */
export async function prepareDelivery(db: PrismaClient, actor: StaffActor, orderId: string, input: PrepareInput, ip?: string | null) {
  assertStaffCan(actor, "manageDeliveries");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
    const o = await tx.order.findUnique({ where: { id: orderId }, select: { id: true, number: true, status: true, organisationId: true, userId: true } });
    if (!o) throw new DomainError("not-found", "No such order.");
    if (!TO_SEND.includes(o.status) && o.status !== "FULFILLED") throw new DomainError("conflict", o.status === "AWAITING_PAYMENT" ? "This order isn't paid yet." : "This order was cancelled.");
    const lines = await linesToDeliver(tx, orderId);
    const errors: Record<string, string> = {};
    const chosen: { orderLineId: string; quantity: number }[] = [];
    for (const l of lines) {
      const t = (input.quantities[l.id] ?? "").trim();
      if (!t || t === "0") continue;
      const n = /^\d{1,6}$/.test(t) ? Number(t) : NaN;
      if (!Number.isInteger(n) || n > l.toDeliver) errors[`qty-${l.id}`] = l.toDeliver ? `Enter up to ${l.toDeliver}.` : "Nothing of this line is left to deliver.";
      else chosen.push({ orderLineId: l.id, quantity: n });
    }
    if (Object.keys(errors).length) throw new DomainError("invalid", "Check the highlighted fields.", undefined, errors);
    if (!chosen.length) throw new DomainError("invalid", "Put at least one item in the delivery.");
    const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('delivery_number_seq') AS n`;
    const warehouse = await defaultWarehouse(tx);
    const d = await tx.delivery.create({ data: { number: `DN-${n}`, orderId, warehouseId: warehouse?.id ?? null, carrier: input.carrier.trim().slice(0, 80), reference: input.reference.trim().slice(0, 80), createdByLabel: actor.name, lines: { create: chosen } } });
    const units = chosen.reduce((s, c) => s + c.quantity, 0);
    await audit(tx, staffAudit(actor, { action: "delivery.prepared", summary: `Packed delivery ${d.number} for order ${o.number}: ${units} ${units === 1 ? "item" : "items"}`, organisationId: o.organisationId, subjectUserId: o.userId, targetType: "Order", targetId: orderId, ipAddress: ip }));
    return d;
  });
}

async function lockedDelivery(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM "Delivery" WHERE id = ${id} FOR UPDATE`;
  const d = await tx.delivery.findUnique({ where: { id }, include: { lines: true, order: { include: { market: true } } } });
  if (!d) throw new DomainError("not-found", "No such delivery.");
  return d;
}

/** Unpacks a delivery that hasn't left. */
export async function cancelDelivery(db: PrismaClient, actor: StaffActor, id: string, ip?: string | null) {
  assertStaffCan(actor, "manageDeliveries");
  await db.$transaction(async (tx) => {
    const d = await lockedDelivery(tx, id);
    if (d.status !== "PREPARED") throw new DomainError("conflict", "This delivery has already left.");
    await tx.delivery.delete({ where: { id } });
    await audit(tx, staffAudit(actor, { action: "delivery.cancelled", summary: `Unpacked delivery ${d.number} for order ${d.order.number}`, organisationId: d.order.organisationId, subjectUserId: d.order.userId, targetType: "Order", targetId: d.orderId, ipAddress: ip }));
  });
}

/**
 * The delivery has left: its goods come out of stock and its lines are out
 * for delivery. When nothing is left to send, the order is sent (or ready
 * to collect) and the customer told.
 */
export async function dispatchDelivery(db: PrismaClient, actor: StaffActor, deps: OrderDeps, id: string, input: { carrier: string; reference: string }, ip?: string | null) {
  assertStaffCan(actor, "manageDeliveries");
  const now = deps.now ?? new Date();
  await db.$transaction(async (tx) => {
    const d = await lockedDelivery(tx, id);
    if (d.status !== "PREPARED") throw new DomainError("conflict", "This delivery has already left.");
    const o = d.order;
    if (!TO_SEND.includes(o.status) && o.status !== "FULFILLED") throw new DomainError("conflict", "This order was cancelled. Unpack the delivery instead.");
    const carrier = input.carrier.trim().slice(0, 80) || d.carrier;
    const reference = input.reference.trim().slice(0, 80) || d.reference;
    await tx.delivery.update({ where: { id }, data: { status: "DISPATCHED", dispatchedAt: now, carrier, reference } });
    const orderLines = await tx.orderLine.findMany({ where: { orderId: o.id }, select: { id: true, quantity: true } });
    const left = await inDeliveries(tx, o.id, true);
    // `left` already counts this delivery; what remained before it is what it takes plus what is still to go.
    await issueForDelivery(tx, d.lines.map((l) => {
      const q = orderLines.find((x) => x.id === l.orderLineId)!.quantity;
      return { orderLineId: l.orderLineId, quantity: l.quantity, remaining: q - (left.get(l.orderLineId) ?? 0) + l.quantity };
    }), actor.name);
    const note = [carrier, reference].filter(Boolean).join(", ");
    await advanceLines(tx, d.lines.map((l) => l.orderLineId), "OUT_FOR_DELIVERY", actor.name, `Delivery ${d.number}${note ? `, ${note}` : ""}`, now);
    const everything = orderLines.every((l) => (left.get(l.id) ?? 0) >= l.quantity);
    if (everything && TO_SEND.includes(o.status)) {
      await tx.order.update({ where: { id: o.id }, data: { status: "FULFILLED", fulfilledAt: now } });
      await issueInvoice(tx, deps.key, o.id, now);
    }
    // Serial-numbered items in it start their warranty today.
    await syncUnits(tx, o.id);
    if (everything && TO_SEND.includes(o.status)) {
      await queueEmail(tx, deps.key, { to: o.email, kind: o.fulfilment === "COLLECTION" ? "order.ready" : "order.sent", payload: { ...orderEmailPayload(o, o.market), note: o.fulfilment === "DELIVERY" && note ? `It is with ${note}.` : "" } });
    }
    await audit(tx, staffAudit(actor, { action: "delivery.dispatched", summary: `Dispatched delivery ${d.number} for order ${o.number}${note ? ` with ${note}` : ""}${everything ? "; the whole order has now left" : ""}`, organisationId: o.organisationId, subjectUserId: o.userId, targetType: "Order", targetId: o.id, ipAddress: ip, visibleToCustomer: Boolean(o.userId || o.organisationId) }));
  });
}

/** What proof of delivery may be: a PDF or a photo. */
export function podType(bytes: Uint8Array): string {
  if (bytes.length > MAX_POD_BYTES) throw new DomainError("invalid", "The file is larger than 10 MB. Send a smaller one.", "file");
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "application/pdf";
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  throw new DomainError("invalid", "Send a PDF or a photo (PNG or JPEG).", "file");
}

/** Signed for: who took it, and the signed note or a photo as proof. */
export async function markDelivered(db: PrismaClient, actor: StaffActor, deps: OrderDeps, id: string, receivedByInput: string, file: { name: string; bytes: Uint8Array } | null, ip?: string | null) {
  assertStaffCan(actor, "manageDeliveries");
  const now = deps.now ?? new Date();
  const receivedBy = receivedByInput.trim().slice(0, 120);
  if (receivedBy.length < 2) throw new DomainError("invalid", "Enter who signed for it.", "receivedBy");
  const pod = file && file.bytes.length ? { podFilename: file.name.replace(/[^\w .()-]/g, "_").slice(-120) || "proof", podContentType: podType(file.bytes), podBytes: new Uint8Array(file.bytes) } : {};
  await db.$transaction(async (tx) => {
    const d = await lockedDelivery(tx, id);
    if (d.status === "PREPARED") throw new DomainError("conflict", "Dispatch it first.");
    await tx.delivery.update({ where: { id }, data: { status: "DELIVERED", deliveredAt: d.deliveredAt ?? now, receivedBy, ...pod } });
    // A line is delivered once all of it has been signed for.
    const done = await tx.deliveryLine.groupBy({ by: ["orderLineId"], where: { delivery: { orderId: d.orderId, status: "DELIVERED" } }, _sum: { quantity: true } });
    const lines = await tx.orderLine.findMany({ where: { id: { in: d.lines.map((l) => l.orderLineId) } }, select: { id: true, quantity: true } });
    const full = lines.filter((l) => (done.find((x) => x.orderLineId === l.id)?._sum.quantity ?? 0) >= l.quantity).map((l) => l.id);
    await advanceLines(tx, full, "DELIVERED", actor.name, `Signed for by ${receivedBy}`, d.deliveredAt ?? now);
    await audit(tx, staffAudit(actor, { action: "delivery.delivered", summary: `Delivery ${d.number} for order ${d.order.number} was signed for by ${receivedBy}${"podFilename" in pod ? ", with proof attached" : ""}`, organisationId: d.order.organisationId, subjectUserId: d.order.userId, targetType: "Order", targetId: d.orderId, ipAddress: ip, visibleToCustomer: Boolean(d.order.userId || d.order.organisationId) }));
  });
}

// ─── Reading ─────────────────────────────────────────────────────────

export const DELIVERY_INCLUDE = { lines: { include: { orderLine: { select: { description: true, mpn: true, sortOrder: true } } } }, warehouse: { select: { code: true, name: true, address: true } } } satisfies Prisma.DeliveryInclude;

export async function deliveriesFor(db: Pick<PrismaClient, "delivery">, orderId: string) {
  return db.delivery.findMany({ where: { orderId }, orderBy: { createdAt: "asc" }, include: DELIVERY_INCLUDE, omit: { podBytes: true } });
}

export async function listDeliveries(db: Pick<PrismaClient, "delivery">, f: { status?: keyof typeof DELIVERY_STATUS_LABEL; q?: string } = {}) {
  const q = f.q?.trim();
  return db.delivery.findMany({
    where: { ...(f.status ? { status: f.status } : {}), ...(q ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { reference: { contains: q, mode: "insensitive" } }, { order: { number: { contains: q, mode: "insensitive" } } }, { order: { name: { contains: q, mode: "insensitive" } } }] } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
    omit: { podBytes: true },
    include: { order: { select: { id: true, number: true, name: true, fulfilment: true } }, _count: { select: { lines: true } } },
  });
}

/** Counts for the admin menu: being packed, and on the road. */
export async function deliveriesWaiting(db: Pick<PrismaClient, "delivery">) {
  const [packed, onTheRoad] = await Promise.all([db.delivery.count({ where: { status: "PREPARED" } }), db.delivery.count({ where: { status: "DISPATCHED" } })]);
  return { packed, onTheRoad };
}

/** A delivery with its order, for its note and proof. */
export async function deliveryWithOrder(db: Pick<PrismaClient, "delivery">, number: string) {
  return db.delivery.findUnique({ where: { number }, include: { ...DELIVERY_INCLUDE, order: { include: { market: true } } } });
}

/** The serial numbers the suppliers gave for each order line. */
export async function serialsFor(db: Pick<PrismaClient, "purchaseOrderLine">, orderLineIds: string[]) {
  const rows = await db.purchaseOrderLine.findMany({ where: { orderLineId: { in: orderLineIds }, serials: { not: "" }, purchaseOrder: { status: { not: "CANCELLED" } } }, select: { orderLineId: true, serials: true } });
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.orderLineId!, [...(out.get(r.orderLineId!) ?? []), ...r.serials.split("\n").filter(Boolean)]);
  return out;
}
