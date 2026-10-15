import type { PoDocumentKind, Prisma, PrismaClient } from "@prisma/client";
import { readSerials } from "@/lib/procurement";
import { audit, staffAudit, SYSTEM_ACTOR } from "@/server/audit";
import { hashToken } from "@/server/auth/tokens";
import { queueEmail } from "@/server/email/outbox";
import { DomainError } from "@/server/errors";
import { advanceLines, poLineIds } from "@/server/logistics/tracking";
import { assertStaffCan, type StaffActor } from "@/server/staff/access";
import { DOCUMENT_KIND_LABEL, procurementAddresses, procurementSettings } from "./common";
import { deliverToFor, type PoDeps } from "./purchase-orders";

/**
 * The supplier's side of a purchase order, on the page their link opens
 * (or typed in by staff from what they said): confirming it with their
 * reference and ship dates, saying it has shipped with the serial numbers,
 * and sending their invoice and packing list. Procurement staff hear about
 * each change by email.
 */

export const MAX_PO_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** Who is answering: the supplier through their link, or staff for them. */
export type PoAnswerer = { token: string } | { actor: StaffActor; id: string; ip?: string | null };

export const SUPPLIER_PO_INCLUDE = {
  supplier: { select: { name: true, currency: true } },
  lines: { orderBy: { position: "asc" }, select: { id: true, position: true, description: true, mpn: true, quantity: true, unitCostMinor: true, lineTotalMinor: true, confirmedQuantity: true, shipDate: true, serials: true, note: true } },
  documents: { orderBy: { createdAt: "asc" }, select: { id: true, kind: true, filename: true, size: true, createdAt: true, uploadedByLabel: true } },
} satisfies Prisma.PurchaseOrderInclude;

/** Only what the supplier may see: never the customer, our order or our prices. */
export const SUPPLIER_PO_OMIT = { totalBaseMinor: true, reviewReasons: true, tokenHash: true, tokenSealed: true, approvedByLabel: true, orderId: true } satisfies Prisma.PurchaseOrderOmit;

export type SupplierPo = Prisma.PurchaseOrderGetPayload<{ include: typeof SUPPLIER_PO_INCLUDE; omit: typeof SUPPLIER_PO_OMIT }>;

/** The purchase order behind a supplier's link, once it has been sent. Null when the link is wrong. */
export async function poByToken(db: Pick<PrismaClient, "purchaseOrder">, token: string): Promise<SupplierPo | null> {
  if (!token || token.length > 100) return null;
  const po = await db.purchaseOrder.findUnique({ where: { tokenHash: hashToken(token) }, include: SUPPLIER_PO_INCLUDE, omit: SUPPLIER_PO_OMIT });
  return po && po.status !== "AWAITING_APPROVAL" ? po : null;
}

/** The supplier may still confirm or ship it. */
export const supplierCanChange = (status: string) => status === "SENT" || status === "TO_SEND_BY_HAND" || status === "CONFIRMED";

async function target(tx: Prisma.TransactionClient, who: PoAnswerer) {
  if ("actor" in who) assertStaffCan(who.actor, "managePurchaseOrders");
  const where = "actor" in who ? { id: who.id } : { tokenHash: hashToken(who.token) };
  const found = await tx.purchaseOrder.findUnique({ where, select: { id: true } });
  if (!found) throw new DomainError("not-found", "This link doesn't work. Check you used the whole link from our message.");
  await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE id = ${found.id} FOR UPDATE`;
  const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: found.id }, include: { supplier: true, lines: { orderBy: { position: "asc" } } } });
  if (po.status === "AWAITING_APPROVAL" && !("actor" in who)) throw new DomainError("not-found", "This link doesn't work. Check you used the whole link from our message.");
  return po;
}

function day(text: string, field: string, errors: Record<string, string>, today: Date, mayBePast = false): Date | null {
  const t = text.trim();
  if (!t) return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(t) ? new Date(`${t}T12:00:00Z`) : null;
  if (!d || Number.isNaN(d.getTime())) errors[field] = "Enter a date.";
  else if (!mayBePast && d.getTime() < today.getTime() - 86_400_000) errors[field] = "Enter a date from today on.";
  else if (d.getTime() > today.getTime() + 366 * 86_400_000) errors[field] = "Enter a date within a year.";
  return d;
}

async function tell(tx: Prisma.TransactionClient, deps: PoDeps, who: PoAnswerer, po: { id: string; number: string; supplier: { name: string } }, what: string, action: string) {
  const summary = `${"actor" in who ? `Recorded for ${po.supplier.name}: ` : `${po.supplier.name}: `}${what} (purchase order ${po.number})`;
  await audit(tx, "actor" in who ? staffAudit(who.actor, { action, summary, targetType: "PurchaseOrder", targetId: po.id, ipAddress: who.ip }) : { ...SYSTEM_ACTOR, actorLabel: po.supplier.name, action, summary, targetType: "PurchaseOrder", targetId: po.id });
  if (!("actor" in who)) for (const to of await procurementAddresses(tx)) await queueEmail(tx, deps.key, { to, kind: "po.updated", payload: { number: po.number, supplier: po.supplier.name, what, poId: po.id } });
}

export interface ConfirmInput {
  supplierReference: string;
  /** yyyy-mm-dd */
  expectedShipDate: string;
  note: string;
  lines: { lineId: string; confirmedQuantity: string; shipDate: string; note: string }[];
}

/** The supplier confirms the order: their reference, when it ships, and any line they can only partly supply. */
export async function confirmPurchaseOrder(db: PrismaClient, deps: PoDeps, who: PoAnswerer, input: ConfirmInput) {
  const now = deps.now ?? new Date();
  await db.$transaction(async (tx) => {
    const po = await target(tx, who);
    if (!supplierCanChange(po.status)) throw new DomainError("conflict", po.status === "CANCELLED" ? "This purchase order was cancelled." : "This purchase order has shipped, so it can't be changed now.");
    const errors: Record<string, string> = {};
    const supplierReference = input.supplierReference.trim().slice(0, 60);
    const expected = day(input.expectedShipDate, "expectedShipDate", errors, now);
    if (!expected && !errors.expectedShipDate) errors.expectedShipDate = "Enter when it ships.";
    const lines = [];
    for (const l of input.lines) {
      const line = po.lines.find((x) => x.id === l.lineId);
      if (!line) continue;
      let confirmed: number | null = null;
      if (l.confirmedQuantity.trim()) {
        const n = Number(l.confirmedQuantity.trim());
        if (!Number.isInteger(n) || n < 0 || n > line.quantity) errors[`qty-${line.id}`] = `Enter a whole number up to ${line.quantity}.`;
        else confirmed = n === line.quantity ? null : n;
      }
      const shipDate = day(l.shipDate, `ship-${line.id}`, errors, now);
      lines.push({ id: line.id, confirmedQuantity: confirmed, shipDate, note: l.note.trim().slice(0, 300) });
    }
    if (Object.keys(errors).length) throw new DomainError("invalid", "Check the highlighted fields.", undefined, errors);
    for (const l of lines) await tx.purchaseOrderLine.update({ where: { id: l.id }, data: { confirmedQuantity: l.confirmedQuantity, shipDate: l.shipDate, note: l.note } });
    await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: "CONFIRMED", confirmedAt: po.confirmedAt ?? now, sentAt: po.sentAt ?? now, supplierReference, expectedShipDate: expected, supplierNote: input.note.trim().slice(0, 1000) } });
    const short = lines.filter((l) => l.confirmedQuantity !== null).length;
    await tell(tx, deps, who, po, `${po.confirmedAt ? "updated the confirmation" : "confirmed it"}, shipping ${input.expectedShipDate.trim()}${supplierReference ? `, their reference ${supplierReference}` : ""}${short ? `; ${short} ${short === 1 ? "line" : "lines"} only in part` : ""}`, "po.confirmed");
  });
}

export interface ShipInput {
  /** yyyy-mm-dd */
  shippedOn: string;
  shippingReference: string;
  lines: { lineId: string; serials: string }[];
}

/** The supplier has shipped it: when, the waybill and the serial numbers of the units. */
export async function shipPurchaseOrder(db: PrismaClient, deps: PoDeps, who: PoAnswerer, input: ShipInput) {
  const now = deps.now ?? new Date();
  await db.$transaction(async (tx) => {
    const po = await target(tx, who);
    if (!supplierCanChange(po.status)) throw new DomainError("conflict", po.status === "CANCELLED" ? "This purchase order was cancelled." : "This purchase order is already marked as shipped.");
    const errors: Record<string, string> = {};
    const shipped = day(input.shippedOn, "shippedOn", errors, now, true);
    if (!shipped && !errors.shippedOn) errors.shippedOn = "Enter when it shipped.";
    else if (shipped && shipped.getTime() > now.getTime() + 86_400_000) errors.shippedOn = "Enter the day it left you, today or before.";
    const shippingReference = input.shippingReference.trim().slice(0, 80);
    const serials = new Map<string, string[]>();
    for (const l of input.lines) {
      const line = po.lines.find((x) => x.id === l.lineId);
      if (!line) continue;
      const list = readSerials(l.serials);
      const units = line.confirmedQuantity ?? line.quantity;
      if (list.length > units) errors[`serials-${line.id}`] = `That is ${list.length} serial numbers for ${units} ${units === 1 ? "unit" : "units"}.`;
      else if (list.some((s) => s.length > 60)) errors[`serials-${line.id}`] = "A serial number is too long. Put one per line.";
      serials.set(line.id, list);
    }
    if (Object.keys(errors).length) throw new DomainError("invalid", "Check the highlighted fields.", undefined, errors);
    for (const [id, list] of serials) await tx.purchaseOrderLine.update({ where: { id }, data: { serials: list.join("\n") } });
    await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: "SHIPPED", shippedAt: shipped, shippingReference, confirmedAt: po.confirmedAt ?? now, sentAt: po.sentAt ?? now } });
    await advanceLines(tx, await poLineIds(tx, [po.id]), "SHIPPED", "actor" in who ? who.actor.name : po.supplier.name, shippingReference ? `Waybill ${shippingReference}` : "", shipped ?? now);
    const count = [...serials.values()].reduce((s, l) => s + l.length, 0);
    await tell(tx, deps, who, po, `shipped it on ${input.shippedOn.trim()}${shippingReference ? `, waybill ${shippingReference}` : ""}${count ? `, with ${count} serial ${count === 1 ? "number" : "numbers"}` : ""}`, "po.shipped");
  });
}

/** What a supplier document may be: PDF, a picture, or a spreadsheet. */
export function poDocumentType(file: { name: string; bytes: Uint8Array }): string {
  const b = file.bytes;
  if (b.length > MAX_PO_DOCUMENT_BYTES) throw new DomainError("invalid", "The file is larger than 10 MB. Send a smaller one.", "file");
  if (b.length < 4) throw new DomainError("invalid", "Choose a file.", "file");
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x50 && b[1] === 0x4b && /\.xlsx$/i.test(file.name)) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (/\.csv$/i.test(file.name) && !new TextDecoder().decode(b.slice(0, 4096)).includes("\u0000")) return "text/csv";
  throw new DomainError("invalid", "Send a PDF, a photo (PNG or JPEG), an Excel (.xlsx) or a CSV file.", "file");
}

const KINDS: PoDocumentKind[] = ["INVOICE", "PACKING_LIST", "OTHER"];

/** The supplier's invoice, packing list or other paper. */
export async function addPoDocument(db: PrismaClient, deps: PoDeps, who: PoAnswerer, kindInput: string, file: { name: string; bytes: Uint8Array } | null) {
  if (!KINDS.includes(kindInput as PoDocumentKind)) throw new DomainError("invalid", "Choose what it is.", "kind");
  const kind = kindInput as PoDocumentKind;
  if (!file) throw new DomainError("invalid", "Choose a file.", "file");
  const contentType = poDocumentType(file);
  const filename = file.name.replace(/[^\w .()-]/g, "_").slice(-120) || "document";
  await db.$transaction(async (tx) => {
    const po = await target(tx, who);
    if (po.status === "CANCELLED") throw new DomainError("conflict", "This purchase order was cancelled.");
    const count = await tx.purchaseOrderDocument.count({ where: { purchaseOrderId: po.id } });
    if (count >= 30) throw new DomainError("invalid", "This purchase order already has 30 files. Contact us to send more.", "file");
    await tx.purchaseOrderDocument.create({ data: { purchaseOrderId: po.id, kind, filename, contentType, size: file.bytes.length, bytes: new Uint8Array(file.bytes), uploadedByLabel: "actor" in who ? who.actor.name : po.supplier.name } });
    await tell(tx, deps, who, po, `sent ${DOCUMENT_KIND_LABEL[kind] === "Other" ? "a file" : `their ${DOCUMENT_KIND_LABEL[kind].toLowerCase()}`}, ${filename}`, "po.document");
  });
}

/** A supplier document, for staff or for the supplier through their link. */
export async function readPoDocument(db: Pick<PrismaClient, "purchaseOrderDocument">, documentId: string, who: { actor: StaffActor } | { token: string }) {
  if ("actor" in who) assertStaffCan(who.actor, "viewPurchaseOrders");
  const doc = await db.purchaseOrderDocument.findUnique({ where: { id: documentId }, include: { purchaseOrder: { select: { tokenHash: true, status: true } } } });
  if (!doc || ("token" in who && (doc.purchaseOrder.tokenHash !== hashToken(who.token) || doc.purchaseOrder.status === "AWAITING_APPROVAL"))) throw new DomainError("not-found", "No such file.");
  return doc;
}

/** For the purchase order page and PDF: where to deliver and how we pay. */
export async function poTerms(db: PrismaClient, poId: string) {
  const [s, po] = await Promise.all([procurementSettings(db), db.purchaseOrder.findUnique({ where: { id: poId }, select: { dropShip: true, warehouseId: true, orderId: true } })]);
  return { deliverTo: po ? await deliverToFor(db, po, s.deliverTo) : s.deliverTo, paymentTerms: s.paymentTerms };
}

// ─── Forms ───────────────────────────────────────────────────────────

const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const text = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
};

/** The lines as the confirm and ship forms show them, with what was given before. */
export function poFormLines(po: { lines: { id: string; position: number; description: string; mpn: string; quantity: number; confirmedQuantity: number | null; shipDate: Date | null; note: string; serials: string }[] }) {
  return po.lines.map((l) => ({ id: l.id, position: l.position, description: l.description, mpn: l.mpn, quantity: l.quantity, confirmedQuantity: l.confirmedQuantity === null ? "" : String(l.confirmedQuantity), shipDate: ymd(l.shipDate), note: l.note, serials: l.serials }));
}

export function poFormGiven(po: { supplierReference: string | null; expectedShipDate: Date | null; supplierNote: string | null; shippedAt: Date | null; shippingReference: string | null }) {
  return { supplierReference: po.supplierReference ?? "", expectedShipDate: ymd(po.expectedShipDate), note: po.supplierNote ?? "", shippedOn: ymd(po.shippedAt), shippingReference: po.shippingReference ?? "" };
}

export function confirmFromForm(form: FormData): ConfirmInput {
  const ids = form.getAll("line").filter((v): v is string => typeof v === "string");
  return { supplierReference: text(form, "supplierReference"), expectedShipDate: text(form, "expectedShipDate"), note: text(form, "note"), lines: ids.map((id) => ({ lineId: id, confirmedQuantity: text(form, `qty-${id}`), shipDate: text(form, `ship-${id}`), note: text(form, `note-${id}`) })) };
}

export function shipFromForm(form: FormData): ShipInput {
  const ids = form.getAll("line").filter((v): v is string => typeof v === "string");
  return { shippedOn: text(form, "shippedOn"), shippingReference: text(form, "shippingReference"), lines: ids.map((id) => ({ lineId: id, serials: text(form, `serials-${id}`) })) };
}
