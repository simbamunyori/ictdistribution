import type { LineTracking, Prisma, PrismaClient } from "@prisma/client";
import { isForward, TRACKING_LABEL, TRACKING_ORDER } from "@/lib/freight";
import { audit, staffAudit } from "@/server/audit";
import { DomainError } from "@/server/errors";
import { assertStaffCan, type StaffActor } from "@/server/staff/access";

/**
 * Where each order line is on its way to the customer. Purchase orders,
 * shipments and deliveries move it forward by themselves; staff can set
 * any step by hand. Every step is kept, and the customer sees them all.
 */

type Tx = Prisma.TransactionClient;

/** Moves lines forward to a step. Lines already past it stay where they are. Returns how many moved. */
export async function advanceLines(tx: Tx, lineIds: string[], status: LineTracking, byLabel: string, note = "", at = new Date()): Promise<number> {
  if (!lineIds.length) return 0;
  const lines = await tx.orderLine.findMany({ where: { id: { in: [...new Set(lineIds)] } }, select: { id: true, tracking: true } });
  const moving = lines.filter((l) => isForward(l.tracking, status));
  if (!moving.length) return 0;
  await tx.orderLine.updateMany({ where: { id: { in: moving.map((l) => l.id) } }, data: { tracking: status } });
  await tx.trackingEvent.createMany({ data: moving.map((l) => ({ orderLineId: l.id, status, note: note.slice(0, 300), byLabel, at })) });
  return moving.length;
}

/** The order lines a purchase order buys. */
export async function poLineIds(tx: Tx, purchaseOrderIds: string[]): Promise<string[]> {
  const rows = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: { in: purchaseOrderIds }, orderLineId: { not: null } }, select: { orderLineId: true } });
  return [...new Set(rows.map((r) => r.orderLineId!))];
}

/** Staff set a line's step by hand, forward or back, with a note. */
export async function setLineTracking(db: PrismaClient, actor: StaffActor, orderLineId: string, statusInput: string, noteInput: string, ip?: string | null) {
  assertStaffCan(actor, "manageDeliveries");
  if (!TRACKING_ORDER.includes(statusInput as LineTracking)) throw new DomainError("invalid", "Choose a step.", "status");
  const status = statusInput as LineTracking;
  const note = noteInput.trim().slice(0, 300);
  await db.$transaction(async (tx) => {
    const line = await tx.orderLine.findUnique({ where: { id: orderLineId }, include: { order: { select: { id: true, number: true, organisationId: true, userId: true } } } });
    if (!line) throw new DomainError("not-found", "No such order line.");
    await tx.orderLine.update({ where: { id: line.id }, data: { tracking: status } });
    await tx.trackingEvent.create({ data: { orderLineId: line.id, status, note, byLabel: actor.name } });
    await audit(tx, staffAudit(actor, { action: "tracking.set", summary: `Set ${line.description} on order ${line.order.number} to ${TRACKING_LABEL[status]}${note ? `: ${note}` : ""}`, organisationId: line.order.organisationId, subjectUserId: line.order.userId, targetType: "Order", targetId: line.order.id, ipAddress: ip }));
  });
}

/** Each line's steps, oldest first, and the order's deliveries, for the order pages. */
export async function orderLogistics(db: Pick<PrismaClient, "trackingEvent" | "delivery">, orderId: string) {
  const [events, deliveries] = await Promise.all([
    db.trackingEvent.findMany({ where: { orderLine: { orderId } }, orderBy: [{ at: "asc" }, { id: "asc" }], select: { id: true, orderLineId: true, status: true, note: true, byLabel: true, at: true } }),
    db.delivery.findMany({ where: { orderId }, orderBy: { createdAt: "asc" }, omit: { podBytes: true }, include: { lines: { select: { orderLineId: true, quantity: true } } } }),
  ]);
  const byLine = new Map<string, typeof events>();
  for (const e of events) byLine.set(e.orderLineId, [...(byLine.get(e.orderLineId) ?? []), e]);
  return { events: byLine, deliveries };
}

export type OrderLogistics = Awaited<ReturnType<typeof orderLogistics>>;
