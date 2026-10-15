import type { Prisma, PrismaClient, WhatsAppStatus } from "@prisma/client";
import { rfqReferenceIn } from "@/lib/quote-reading";
import { OPEN_STATUSES, type QuoteDeps } from "@/server/quotes/common";
import { applySupplierReply, replyFileType, type ReplyFile } from "@/server/quotes/suppliers";
import { digits, WhatsAppError, type CloudApi, type InboundMessage, type StatusUpdate } from "./cloud";
import { backoffMs, backToStaff, MAX_ATTEMPTS } from "./outbox";

/**
 * Messages from suppliers on WhatsApp. Webhook calls are stored first
 * and read by the whatsapp job, so Meta gets its answer straight away.
 * The sender's number finds the supplier and the message finds their
 * request; then the same reader as email replies reads the prices and
 * the quote is priced again. Only a supplier's own numbers can set prices.
 */

const ORDER: Partial<Record<WhatsAppStatus, number>> = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3 };
const STATUS: Record<StatusUpdate["status"], WhatsAppStatus> = { sent: "SENT", delivered: "DELIVERED", read: "READ", failed: "FAILED" };

/**
 * One webhook call: new messages are stored (once each, by their wamid)
 * for the job to read, and our messages' statuses move forward. A
 * message that failed after it was accepted goes back to staff.
 */
export async function recordWebhook(db: PrismaClient, parsed: { messages: InboundMessage[]; statuses: StatusUpdate[] }): Promise<number> {
  let stored = 0;
  for (const m of parsed.messages) {
    const made = await db.whatsAppMessage.createMany({
      data: [{ direction: "IN", number: m.from, status: "RECEIVED", waMessageId: m.id, contextId: m.contextId, text: m.text.slice(0, 20_000), payload: { type: m.type, name: m.name.slice(0, 100), media: m.media, at: m.at.toISOString() } }],
      skipDuplicates: true,
    });
    stored += made.count;
  }
  for (const s of parsed.statuses) {
    const row = await db.whatsAppMessage.findUnique({ where: { waMessageId: s.id } });
    if (!row || row.direction !== "OUT") continue;
    const next = STATUS[s.status];
    if (next === "FAILED") {
      if (row.status === "READ" || row.status === "FAILED") continue;
      await db.whatsAppMessage.update({ where: { id: row.id }, data: { status: "FAILED", lastError: s.error?.slice(0, 500) ?? "Failed" } });
      await backToStaff(db, row.requestId, s.error ?? "it failed");
      continue;
    }
    if ((ORDER[next] ?? 0) <= (ORDER[row.status] ?? -1)) continue;
    await db.whatsAppMessage.update({ where: { id: row.id }, data: { status: next, ...(next === "DELIVERED" ? { deliveredAt: s.at } : next === "READ" ? { readAt: s.at, deliveredAt: row.deliveredAt ?? s.at } : {}) } });
  }
  return stored;
}

/** The suppliers whose own numbers (their WhatsApp, their phone, or a contact's) match. */
export async function suppliersByNumber(db: Pick<PrismaClient, "supplier">, number: string): Promise<string[]> {
  const want = digits(number);
  if (want.length < 6) return [];
  const all = await db.supplier.findMany({ where: { OR: [{ whatsapp: { not: null } }, { phone: { not: null } }, { contacts: { some: { OR: [{ whatsapp: { not: null } }, { phone: { not: null } }] } } }] }, select: { id: true, whatsapp: true, phone: true, contacts: { select: { whatsapp: true, phone: true } } } });
  return all.filter((s) => [s.whatsapp, s.phone, ...s.contacts.flatMap((c) => [c.whatsapp, c.phone])].some((n) => n && digits(n) === want)).map((s) => s.id);
}

/**
 * Which request a supplier's message answers: the one whose message they
 * replied to, else the reference in their text, else their most recent
 * request still open. Only requests to one of `supplierIds`.
 */
export async function requestForMessage(db: Pick<PrismaClient, "whatsAppMessage" | "supplierPriceRequest">, supplierIds: string[], contextId: string | null, text: string): Promise<{ id: string; supplierId: string } | null> {
  if (!supplierIds.length) return null;
  if (contextId) {
    const ours = await db.whatsAppMessage.findUnique({ where: { waMessageId: contextId }, select: { request: { select: { id: true, supplierId: true } } } });
    if (ours?.request && supplierIds.includes(ours.request.supplierId)) return ours.request;
  }
  const reference = rfqReferenceIn(text);
  if (reference) {
    const r = await db.supplierPriceRequest.findUnique({ where: { reference }, select: { id: true, supplierId: true } });
    if (r && supplierIds.includes(r.supplierId)) return r;
  }
  return db.supplierPriceRequest.findFirst({ where: { supplierId: { in: supplierIds }, status: { in: ["SENT", "TO_SEND_BY_HAND", "RESPONDED"] }, quote: { status: { in: OPEN_STATUSES } } }, orderBy: [{ sentAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }], select: { id: true, supplierId: true } });
}

/** What became of one message, for the job's count and the admin area. */
type Outcome = { status: "HANDLED" | "KEPT" | "IGNORED"; note: string; requestId?: string; supplierId?: string };

async function handleOne(db: PrismaClient, deps: QuoteDeps, api: CloudApi | null, row: { id: string; number: string; text: string; contextId: string | null; payload: Prisma.JsonValue }): Promise<Outcome> {
  const payload = (row.payload ?? {}) as { type?: string; media?: { id: string; mimeType: string; filename: string } | null };
  const suppliers = await suppliersByNumber(db, row.number);
  let request = await requestForMessage(db, suppliers, row.contextId, row.text);
  let own = true;
  if (!request) {
    // Someone else naming one of our references: kept on that request for staff, never priced.
    const reference = rfqReferenceIn(row.text);
    request = reference ? await db.supplierPriceRequest.findUnique({ where: { reference }, select: { id: true, supplierId: true } }) : null;
    own = false;
  }
  if (!request) return suppliers.length ? { status: "IGNORED", note: "From a supplier, but they have no open request.", supplierId: suppliers[0] } : { status: "IGNORED", note: "Not a number we have for any supplier." };
  if (!row.text.trim() && !payload.media) return { status: "IGNORED", note: `Nothing in it to read (a ${payload.type ?? "message"}).`, requestId: request.id, supplierId: request.supplierId };
  const files: ReplyFile[] = [];
  let fileNote = "";
  if (payload.media) {
    if (!api) fileNote = " Their file couldn't be fetched because WhatsApp isn't connected.";
    else {
      try {
        const got = await api.downloadMedia(payload.media.id);
        const mediaType = replyFileType(payload.media.filename, payload.media.mimeType || got.mimeType, got.bytes);
        if (mediaType) files.push({ name: payload.media.filename, mediaType, bytes: got.bytes });
        else fileNote = ` Their file (${payload.media.filename}) isn't a PDF, spreadsheet or photo, so it wasn't read.`;
      } catch (e) {
        if (!(e instanceof WhatsAppError) || e.retry) throw e;
        fileNote = ` Their file couldn't be fetched: ${e.message}`;
      }
    }
  }
  const result = await applySupplierReply(db, deps, request.id, { channel: "whatsapp", from: `+${row.number}`, own, text: row.text, files });
  return { status: result.read ? "HANDLED" : "KEPT", note: (result.read ? "Prices read." : "Kept for staff to enter.") + fileNote, requestId: request.id, supplierId: request.supplierId };
}

/**
 * Reads the stored messages from suppliers: matches the number to a
 * supplier and the message to their open request, fetches any file, and
 * hands it to the same reader as email replies, which prices the quote
 * again. A message that fails is tried again on the next run.
 */
export async function handleWhatsAppInbound(db: PrismaClient, deps: QuoteDeps, api: CloudApi | null, now = new Date(), limit = 25): Promise<number> {
  const due = await db.whatsAppMessage.findMany({ where: { direction: "IN", status: "RECEIVED", nextAttemptAt: { lte: now } }, orderBy: { createdAt: "asc" }, take: limit });
  let handled = 0;
  for (const row of due) {
    const claim = await db.whatsAppMessage.updateMany({ where: { id: row.id, status: "RECEIVED", attempts: row.attempts }, data: { attempts: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + backoffMs(row.attempts + 1)) } });
    if (claim.count !== 1) continue;
    try {
      const out = await handleOne(db, deps, api, row);
      await db.whatsAppMessage.update({ where: { id: row.id }, data: { status: out.status, note: out.note, requestId: out.requestId ?? null, supplierId: out.supplierId ?? null, lastError: null } });
      handled++;
    } catch (e) {
      const message = e instanceof Error ? e.message.slice(0, 500) : "Unknown error";
      const last = row.attempts + 1 >= MAX_ATTEMPTS;
      await db.whatsAppMessage.update({ where: { id: row.id }, data: { lastError: message, ...(last ? { status: "KEPT", note: "It couldn't be read after several tries. Check it on WhatsApp." } : {}) } });
      if (!last) console.error(`WhatsApp message ${row.id} failed and will be tried again:`, e);
    }
  }
  return handled;
}
