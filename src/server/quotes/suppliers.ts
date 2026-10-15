import type { PrismaClient } from "@prisma/client";
import { formatMoney, parseMoney, toPlainAmount } from "@/lib/money";
import type { Table } from "@/lib/price-list";
import { audit, staffAudit, SYSTEM_ACTOR } from "@/server/audit";
import { open } from "@/server/auth/secret-box";
import { hashToken } from "@/server/auth/tokens";
import { DomainError } from "@/server/errors";
import { assertStaffCan, type StaffActor } from "@/server/staff/access";
import { readTable } from "@/server/suppliers/price-lists";
import { lineRef, OPEN_STATUSES, staffWhen, type QuoteDeps } from "./common";
import { priceQuote } from "./pricing";
import { quoteReader, type ReplyLine } from "./reader";

/**
 * Suppliers' answers to our requests for price: from their response
 * page, from a plain email or WhatsApp reply read by AI (with the quote
 * they attached), or typed by staff. Whichever way, it ends up as the
 * same structured response per line. Suppliers see only our request and
 * its lines, never who the customer is.
 */

const REQUEST_INCLUDE = { supplier: true, quote: { select: { id: true, number: true, status: true } }, responses: true } as const;

/** A request with the lines it asks about, for the supplier page and staff. */
async function withLines<R extends { lineIds: string[]; quoteId: string }>(db: Pick<PrismaClient, "quoteLine">, r: R) {
  const lines = await db.quoteLine.findMany({ where: { id: { in: r.lineIds }, quoteId: r.quoteId }, orderBy: { position: "asc" }, select: { id: true, position: true, description: true, mpn: true, quantity: true } });
  return { ...r, lines };
}

/** The request behind a supplier's link. Null when the link is wrong. */
export async function requestByToken(db: PrismaClient, token: string) {
  if (!token || token.length > 100) return null;
  const r = await db.supplierPriceRequest.findUnique({ where: { tokenHash: hashToken(token) }, include: REQUEST_INCLUDE });
  return r ? withLines(db, r) : null;
}

export function isOpenRequest(r: { status: string; quote: { status: string } }) {
  return r.status !== "CLOSED" && OPEN_STATUSES.includes(r.quote.status as (typeof OPEN_STATUSES)[number]);
}

export interface AnswerLine {
  lineId: string;
  noOffer: boolean;
  price: string;
  available: string;
  leadTimeDays: string;
  /** yyyy-mm-dd */
  validUntil: string;
  notes: string;
  /** Their delivery or freight charge to us per unit. Optional. */
  shipping?: string;
}

export interface AnswerInput {
  lines: AnswerLine[];
  note: string;
}

const wholeNumber = (text: string, max: number) => {
  const t = text.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 && n <= max ? n : undefined;
};

type AnswerSource = "page" | "email" | "whatsapp" | "staff";

async function saveAnswer(db: PrismaClient, deps: QuoteDeps, requestId: string, input: AnswerInput, source: AnswerSource, actor: StaffActor | null, ip?: string | null) {
  const now = deps.now ?? new Date();
  const quoteId = await db.$transaction(async (tx) => {
    const r = await tx.supplierPriceRequest.findUnique({ where: { id: requestId }, include: REQUEST_INCLUDE });
    if (!r) throw new DomainError("not-found", "No such request.");
    if (!isOpenRequest(r)) throw new DomainError("conflict", "This request is closed, so prices can't be changed now.");
    const today = new Date(now.getTime() - (now.getTime() % 86_400_000));
    const fieldErrors: Record<string, string> = {};
    const rows = [];
    for (const l of input.lines) {
      if (!r.lineIds.includes(l.lineId)) continue;
      const shipping = (l.shipping ?? "").trim();
      const blank = !l.noOffer && !l.price.trim() && !l.available.trim() && !l.leadTimeDays.trim() && !l.notes.trim() && !shipping;
      if (blank) continue;
      let cost: bigint | null = null;
      let freight: bigint | null = null;
      if (!l.noOffer) {
        try {
          cost = parseMoney(l.price, r.supplier.currency);
          if (cost <= 0n) throw new Error();
        } catch {
          fieldErrors[`price-${l.lineId}`] = `Enter the price per unit in ${r.supplier.currency}, or tick "Can't supply".`;
        }
        if (shipping) {
          try {
            freight = parseMoney(shipping, r.supplier.currency);
            if (freight < 0n) throw new Error();
          } catch {
            fieldErrors[`shipping-${l.lineId}`] = `Enter the delivery cost per unit in ${r.supplier.currency}, or leave it empty.`;
          }
        }
      }
      const available = wholeNumber(l.available, 1_000_000);
      if (available === undefined) fieldErrors[`available-${l.lineId}`] = "Enter a whole number.";
      const lead = wholeNumber(l.leadTimeDays, 365);
      if (lead === undefined) fieldErrors[`lead-${l.lineId}`] = "Enter days, up to 365.";
      let validUntil: Date | null = null;
      if (l.validUntil.trim()) {
        validUntil = /^\d{4}-\d{2}-\d{2}$/.test(l.validUntil.trim()) ? new Date(`${l.validUntil.trim()}T23:59:59Z`) : null;
        if (!validUntil || Number.isNaN(validUntil.getTime()) || validUntil.getTime() < today.getTime()) fieldErrors[`valid-${l.lineId}`] = "Enter a date from today on.";
      }
      rows.push({ lineId: l.lineId, noOffer: l.noOffer, costMinor: cost, freightMinor: freight, available: available ?? null, leadTimeDays: lead ?? null, validUntil, notes: l.notes.trim().slice(0, 300) });
    }
    if (Object.keys(fieldErrors).length) throw new DomainError("invalid", "Check the highlighted fields.", undefined, fieldErrors);
    if (!rows.length) throw new DomainError("invalid", "Give a price for at least one line, or tick \"Can't supply\".");
    for (const row of rows) {
      const data = { ...row, currency: r.supplier.currency, source };
      await tx.supplierQuoteResponse.upsert({ where: { requestId_lineId: { requestId, lineId: row.lineId } }, create: { requestId, ...data }, update: data });
    }
    await tx.supplierPriceRequest.update({ where: { id: requestId }, data: { status: "RESPONDED", respondedAt: now, note: input.note.trim().slice(0, 1000) || r.note } });
    const priced = rows.filter((x) => !x.noOffer).length;
    const summary = `${r.supplier.name} priced ${priced} of ${r.lineIds.length} ${r.lineIds.length === 1 ? "line" : "lines"} for quote ${r.quote.number} (${r.reference}${source === "email" ? ", read from their email" : source === "whatsapp" ? ", read from their WhatsApp message" : ""})`;
    await audit(tx, actor ? staffAudit(actor, { action: "quote.rfq-answered", summary: `Entered prices from ${summary.replace(/ priced/, ", who priced")}`, targetType: "Quote", targetId: r.quoteId, ipAddress: ip }) : { ...SYSTEM_ACTOR, actorLabel: r.supplier.name, action: "quote.rfq-answered", summary, targetType: "Quote", targetId: r.quoteId });
    return r.quoteId;
  });
  await afterAnswer(db, deps, quoteId);
}

/**
 * Once the last supplier has answered, the quote is priced and sent or
 * queued for review without waiting for the deadline. Answers that come
 * in while it is in review update its prices.
 */
export async function afterAnswer(db: PrismaClient, deps: QuoteDeps, quoteId: string) {
  const q = await db.quote.findUnique({ where: { id: quoteId }, select: { status: true } });
  if (q?.status === "WAITING_ON_SUPPLIERS") {
    const open = await db.supplierPriceRequest.count({ where: { quoteId, status: { in: ["SENT", "TO_SEND_BY_HAND"] } } });
    if (!open) await priceQuote(db, deps, quoteId, { decide: true });
  } else if (q?.status === "REVIEW") {
    await priceQuote(db, deps, quoteId, { decide: false });
  }
}

/** A supplier answers on their response page. */
export async function answerRequest(db: PrismaClient, deps: QuoteDeps, token: string, input: AnswerInput) {
  const r = await db.supplierPriceRequest.findUnique({ where: { tokenHash: hashToken(token) }, select: { id: true } });
  if (!r) throw new DomainError("not-found", "This link doesn't work. Check you used the whole link from our email.");
  await saveAnswer(db, deps, r.id, input, "page", null);
}

/** Staff type in what a supplier told them by phone, WhatsApp or email. */
export async function enterSupplierPrices(db: PrismaClient, actor: StaffActor, deps: QuoteDeps, requestId: string, input: AnswerInput, ip?: string | null) {
  assertStaffCan(actor, "enterSupplierPrices");
  await saveAnswer(db, deps, requestId, input, "staff", actor, ip);
}

/** Staff sent a WhatsApp request by hand: its deadline still stands. */
export async function markSentByHand(db: PrismaClient, actor: StaffActor, deps: QuoteDeps, requestId: string, ip?: string | null) {
  assertStaffCan(actor, "enterSupplierPrices");
  const now = deps.now ?? new Date();
  await db.$transaction(async (tx) => {
    const r = await tx.supplierPriceRequest.findUnique({ where: { id: requestId }, include: REQUEST_INCLUDE });
    if (!r) throw new DomainError("not-found", "No such request.");
    if (r.status !== "TO_SEND_BY_HAND") throw new DomainError("conflict", "This request has already been sent.");
    await tx.supplierPriceRequest.update({ where: { id: requestId }, data: { status: "SENT", sentAt: now } });
    await audit(tx, staffAudit(actor, { action: "quote.rfq-sent-by-hand", summary: `Sent request ${r.reference} for quote ${r.quote.number} to ${r.supplier.name} on WhatsApp`, targetType: "Quote", targetId: r.quoteId, ipAddress: ip }));
  });
}

/** The supplier's response link, opened from its sealed copy, for staff to send by hand. */
export function supplierLink(r: { tokenSealed: string }, key: string, appUrl: string) {
  return `${appUrl}/supplier/rfq/${open(r.tokenSealed, key)}`;
}

/** A WhatsApp message with the request and its link, ready to send. Only digits go in the number. */
export function whatsappLink(r: { tokenSealed: string; reference: string; deadline: Date }, supplier: { whatsapp: string | null; name: string }, lines: { position: number; quantity: number; description: string }[], key: string, appUrl: string, company: string) {
  if (!supplier.whatsapp) return null;
  const text = [`Hello ${supplier.name}, this is ${company}. Please send your best prices for request ${r.reference} by ${staffWhen(r.deadline)}:`, ...lines.map((l) => `${lineRef(l.position)}: ${l.quantity} x ${l.description}`), `Answer here: ${supplierLink(r, key, appUrl)}`].join("\n");
  return `https://wa.me/${supplier.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}

/** A file attached to a supplier's reply. */
export interface ReplyFile {
  name: string;
  mediaType: string;
  bytes: Uint8Array;
}

export type ReplyChannel = "email" | "whatsapp";

/** Their own quote, attached: what the reader can read, and what is kept for staff. */
export const REPLY_FILE_TYPES = /^(application\/pdf|image\/(jpeg|png|gif|webp)|text\/csv|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet)$/;
export const MAX_REPLY_FILE_BYTES = 10 * 1024 * 1024;

/** The media type of an attachment from its first bytes and name, or null when it isn't one we read. */
export function replyFileType(name: string, given: string, bytes: Uint8Array): string | null {
  if (bytes.length > MAX_REPLY_FILE_BYTES || !bytes.length) return null;
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "application/pdf";
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && /\.xlsx$/i.test(name)) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (/\.csv$/i.test(name) || given === "text/csv") return new TextDecoder().decode(bytes.slice(0, 4096)).includes("\u0000") ? null : "text/csv";
  return REPLY_FILE_TYPES.test(given) && given.startsWith("image/") ? given : null;
}

/** The first PDF, the first spreadsheet and up to four photos, for the reader. */
async function forReader(files: ReplyFile[]) {
  const pdf = files.find((f) => f.mediaType === "application/pdf") ?? null;
  const sheet = files.find((f) => f.mediaType === "text/csv" || f.mediaType.includes("spreadsheet"));
  let table: Table | null = null;
  if (sheet)
    table = await readTable(sheet.bytes, sheet.name).then(
      (t) => t.table,
      () => null,
    );
  const images = files.filter((f) => f.mediaType.startsWith("image/")).slice(0, 4);
  return { pdf: pdf ? { name: pdf.name, bytes: pdf.bytes } : null, table, images: images.map((i) => ({ mediaType: i.mediaType, bytes: i.bytes })) };
}

/**
 * A supplier's reply by email or WhatsApp, with any quote they attached.
 * AI reads the prices (and any delivery cost) into the same answer a
 * supplier gives on the page, and the quote is priced again as soon as
 * it can be. When it can't be read (or no AI is set up), or it didn't
 * come from one of the supplier's own addresses or numbers, the reply
 * and its files are kept on the request for staff to enter by hand.
 */
export async function applySupplierReply(db: PrismaClient, deps: QuoteDeps, requestId: string, reply: { channel: ReplyChannel; from: string; own: boolean; text: string; files: ReplyFile[] }): Promise<{ requestId: string; read: boolean }> {
  const r = await db.supplierPriceRequest.findUniqueOrThrow({ where: { id: requestId }, include: REQUEST_INCLUDE });
  const { lines } = await withLines(db, r);
  const files = reply.files.filter((f) => REPLY_FILE_TYPES.test(f.mediaType) && f.bytes.length <= MAX_REPLY_FILE_BYTES).slice(0, 5);
  const by = reply.channel === "email" ? "by email" : "on WhatsApp";
  const received = [reply.text.trim(), ...files.map((f) => `[Attached: ${f.name}]`)].filter(Boolean).join("\n");
  // Every message is kept with the request, newest last, so staff see the whole exchange.
  await db.supplierPriceRequest.update({ where: { id: r.id }, data: { replyText: [r.replyText, received].filter(Boolean).join("\n\n").slice(-20_000) } });
  for (const f of files) await db.supplierReplyFile.create({ data: { requestId: r.id, channel: reply.channel === "email" ? "EMAIL" : "WHATSAPP", name: f.name.slice(0, 200), mediaType: f.mediaType, bytes: Buffer.from(f.bytes) } });
  const keep = async (why: string) => {
    await audit(db, { ...SYSTEM_ACTOR, actorLabel: r.supplier.name, action: "quote.rfq-reply-kept", summary: `${r.supplier.name} replied ${by} to ${r.reference} for quote ${r.quote.number}. ${why}`, targetType: "Quote", targetId: r.quoteId });
    return { requestId: r.id, read: false };
  };
  if (!isOpenRequest(r)) return keep("The request was closed, so the reply is kept for reference.");
  // Only the supplier's own addresses and numbers can set prices; anything else waits for a person.
  if (!reply.own) return keep(`It came from ${reply.from}, which isn't ${reply.channel === "email" ? "an address" : "a number"} we have for them, so check it and enter the prices by hand.`);
  const reader = deps.reader ?? quoteReader();
  const read: ReplyLine[] | null = await reader.readSupplierReply({ text: reply.text, currency: r.supplier.currency, lines: lines.map((l) => ({ ref: lineRef(l.position), description: l.description, quantity: l.quantity })), ...(await forReader(files)) });
  if (!read?.length) return keep("Its prices couldn't be read, so enter them by hand.");
  const byRef = new Map(lines.map((l) => [lineRef(l.position), l.id]));
  const answer: AnswerInput = {
    note: "",
    lines: read.filter((x) => byRef.has(x.ref) && (!x.currency || x.currency.toUpperCase() === r.supplier.currency)).map((x) => ({ lineId: byRef.get(x.ref)!, noOffer: x.noOffer, price: x.unitPrice ?? "", available: x.available === null ? "" : String(x.available), leadTimeDays: x.leadTimeDays === null ? "" : String(x.leadTimeDays), validUntil: x.validUntil ?? "", notes: x.notes, shipping: x.shipping ?? "" })),
  };
  if (!answer.lines.length) return keep(`Its prices aren't in ${r.supplier.currency}, so check them and enter them by hand.`);
  try {
    await saveAnswer(db, deps, r.id, answer, reply.channel, null);
    return { requestId: r.id, read: true };
  } catch (e) {
    if (e instanceof DomainError) return keep(`Its prices couldn't all be used (${e.fieldErrors ? Object.values(e.fieldErrors)[0] : e.message}), so check them and enter them by hand.`);
    throw e;
  }
}

/** A plain email reply to a request, found by the reference in its subject. Only the supplier's own addresses can set prices. */
export async function applyEmailReply(db: PrismaClient, deps: QuoteDeps, reference: string, from: string, text: string, files: ReplyFile[] = []): Promise<{ requestId: string | null; read: boolean }> {
  const r = await db.supplierPriceRequest.findUnique({ where: { reference }, select: { id: true, supplier: { select: { email: true, contacts: { select: { email: true } } } } } });
  if (!r) return { requestId: null, read: false };
  const theirs = [r.supplier.email, ...r.supplier.contacts.map((c) => c.email)].filter(Boolean).map((e) => e!.toLowerCase());
  return applySupplierReply(db, deps, r.id, { channel: "email", from, own: theirs.includes(from.trim().toLowerCase()), text, files });
}

/** A price in the supplier's currency, for staff pages. */
export const supplierMoney = (amountMinor: bigint | null, currency: string, locale: string) => (amountMinor === null ? "" : formatMoney({ amountMinor, currency }, locale));

/** The answer form's fields, the same on the supplier's page and for staff: one group per line, named by the line's id. */
export function answerFromForm(form: FormData): AnswerInput {
  const text = (k: string) => String(form.get(k) ?? "").slice(0, 400);
  const lines = form.getAll("line").map((v) => {
    const id = String(v);
    return { lineId: id, noOffer: form.get(`none-${id}`) === "on", price: text(`price-${id}`), shipping: text(`shipping-${id}`), available: text(`available-${id}`), leadTimeDays: text(`lead-${id}`), validUntil: text(`valid-${id}`), notes: text(`notes-${id}`) };
  });
  return { lines, note: text("note") };
}

/** A request's lines with what was answered before, for the answer form. */
export function answerFormLines(r: { lines: { id: string; position: number; description: string; mpn: string | null; quantity: number }[]; responses: { lineId: string; noOffer: boolean; costMinor: bigint | null; freightMinor: bigint | null; currency: string; available: number | null; leadTimeDays: number | null; validUntil: Date | null; notes: string }[] }) {
  return r.lines.map((l) => {
    const a = r.responses.find((x) => x.lineId === l.id);
    return {
      ...l,
      price: a?.costMinor != null ? toPlainAmount({ amountMinor: a.costMinor, currency: a.currency }) : "",
      shipping: a?.freightMinor != null ? toPlainAmount({ amountMinor: a.freightMinor, currency: a.currency }) : "",
      available: a?.available != null ? String(a.available) : "",
      leadTimeDays: a?.leadTimeDays != null ? String(a.leadTimeDays) : "",
      validUntil: a?.validUntil ? a.validUntil.toISOString().slice(0, 10) : "",
      notes: a?.notes ?? "",
      noOffer: a?.noOffer ?? false,
    };
  });
}
