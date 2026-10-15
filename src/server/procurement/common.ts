import type { PoDocumentKind, PrismaClient, PurchaseOrderStatus } from "@prisma/client";

/** Labels, the Admin's rules and who hears about purchase orders. */

export const PO_STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  AWAITING_APPROVAL: "Waiting for approval",
  TO_SEND_BY_HAND: "To send on WhatsApp",
  SENT: "Sent",
  CONFIRMED: "Confirmed",
  SHIPPED: "Shipped",
  RECEIVED: "Received",
  CANCELLED: "Cancelled",
};

export const PO_STATUS_TONE = { AWAITING_APPROVAL: "highlight", TO_SEND_BY_HAND: "warning", SENT: "neutral", CONFIRMED: "neutral", SHIPPED: "positive", RECEIVED: "positive", CANCELLED: "neutral" } as const;

export const DOCUMENT_KIND_LABEL: Record<PoDocumentKind, string> = { INVOICE: "Invoice", PACKING_LIST: "Packing list", OTHER: "Other" };

/** Sent to the supplier and not yet in our hands or cancelled. */
export const WITH_SUPPLIER: PurchaseOrderStatus[] = ["SENT", "CONFIRMED", "SHIPPED"];

export async function procurementSettings(db: Pick<PrismaClient, "procurementSettings">) {
  return db.procurementSettings.upsert({ where: { id: "global" }, create: { id: "global" }, update: {} });
}

/** Procurement staff, or the Admins when there are none yet. */
export async function procurementAddresses(db: Pick<PrismaClient, "user">): Promise<string[]> {
  const active = { kind: "STAFF" as const, deactivatedAt: null };
  const people = await db.user.findMany({ where: { ...active, staffRole: "PROCUREMENT" }, select: { email: true } });
  return (people.length ? people : await db.user.findMany({ where: { ...active, staffRole: "ADMIN" }, select: { email: true } })).map((p) => p.email);
}
