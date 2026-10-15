import type { Prisma, PrismaClient } from "@prisma/client";
import { audit, SYSTEM_ACTOR } from "@/server/audit";
import { open, seal } from "@/server/auth/secret-box";
import { digits, WhatsAppError, type CloudApi, type WhatsAppConfig } from "./cloud";

/**
 * Requests for price on WhatsApp. They are queued in the same transaction
 * as the request and sent by the whatsapp job with retries, like the
 * email outbox. A WhatsApp-only request whose message can't go is handed
 * back to staff to send by hand.
 */

type Tx = Prisma.TransactionClient;

/** Template values can't hold line breaks, tabs or long runs of spaces, and the whole message must stay under 1,024 characters. */
export function templateText(text: string, max: number): string {
  const clean = text
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

/** The lines as one value: as many as fit, then how many more are on the page. */
export function linesValue(lines: string[], max = 500): string {
  const out: string[] = [];
  for (const [i, line] of lines.entries()) {
    const text = templateText(line, 200);
    // Room for "and 12 more on the page" unless this is the last line.
    const room = i === lines.length - 1 ? max : max - 30;
    if ([...out, text].join("; ").length > room && out.length) return [...out, `and ${lines.length - i} more on the page`].join("; ");
    out.push(text);
  }
  return out.join("; ");
}

/**
 * Queues a request for price on WhatsApp. The template (docs/quotes.md)
 * takes, in order: the supplier's name, the reference, the deadline, the
 * lines, and the link to their response page. The link's token is
 * sealed until the message is sent.
 */
export async function queueRfqWhatsApp(tx: Tx, key: string, input: { requestId: string; supplierId: string; number: string; supplier: string; reference: string; deadline: string; lines: string[]; token: string }) {
  const values = [templateText(input.supplier, 60), input.reference, templateText(input.deadline, 40), linesValue(input.lines)];
  await tx.whatsAppMessage.create({ data: { direction: "OUT", number: digits(input.number), status: "QUEUED", requestId: input.requestId, supplierId: input.supplierId, payload: { kind: "rfq", values, sealed: seal(input.token, key) } } });
}

export const MAX_ATTEMPTS = 6;
/** 1, 2, 4, 8, 16 minutes between tries. */
export const backoffMs = (attempt: number) => 60_000 * 2 ** Math.max(0, attempt - 1);

/** A WhatsApp-only request whose message can't go is handed back to staff to send by hand. */
export async function backToStaff(db: PrismaClient, requestId: string | null, why: string) {
  if (!requestId) return;
  const r = await db.supplierPriceRequest.findUnique({ where: { id: requestId }, include: { supplier: { select: { name: true, email: true } }, quote: { select: { number: true } } } });
  if (!r || r.status !== "SENT" || r.supplier.email) return;
  await db.supplierPriceRequest.update({ where: { id: r.id }, data: { status: "TO_SEND_BY_HAND" } });
  await audit(db, { ...SYSTEM_ACTOR, action: "quote.rfq-whatsapp-failed", summary: `The WhatsApp request ${r.reference} for quote ${r.quote.number} to ${r.supplier.name} didn't go (${why}), so it waits for staff to send by hand`, targetType: "Quote", targetId: r.quoteId });
}

/**
 * Sends the WhatsApp messages that are due. Each row is claimed with a
 * conditional update first, so two workers never send the same message.
 * A message for a request that has closed is dropped.
 */
export async function deliverWhatsApp(db: PrismaClient, api: CloudApi, cfg: Pick<WhatsAppConfig, "template" | "language">, settings: { key: string; appUrl: string }, now = new Date(), limit = 50): Promise<number> {
  const due = await db.whatsAppMessage.findMany({ where: { direction: "OUT", status: "QUEUED", nextAttemptAt: { lte: now } }, orderBy: { createdAt: "asc" }, take: limit, include: { request: { select: { status: true } } } });
  let sent = 0;
  for (const row of due) {
    const claim = await db.whatsAppMessage.updateMany({ where: { id: row.id, status: "QUEUED", attempts: row.attempts }, data: { attempts: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + backoffMs(row.attempts + 1)) } });
    if (claim.count !== 1) continue;
    const { sealed, ...plain } = row.payload as { kind: string; values: string[]; sealed?: string };
    if (!row.request || row.request.status === "CLOSED" || row.request.status === "EXPIRED") {
      await db.whatsAppMessage.update({ where: { id: row.id }, data: { status: "FAILED", lastError: "No longer needed.", payload: plain } });
      continue;
    }
    try {
      if (!sealed) throw new WhatsAppError("The link to their page is missing.", false);
      const link = `${settings.appUrl}/supplier/rfq/${open(sealed, settings.key)}`;
      const waMessageId = await api.sendTemplate(row.number, cfg.template, cfg.language, [...plain.values, link]);
      await db.whatsAppMessage.update({ where: { id: row.id }, data: { status: "SENT", waMessageId, sentAt: now, lastError: null, payload: plain } });
      sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message.slice(0, 500) : "Unknown error";
      const failed = !(err instanceof WhatsAppError && err.retry) || row.attempts + 1 >= MAX_ATTEMPTS;
      await db.whatsAppMessage.update({ where: { id: row.id }, data: { lastError: message, status: failed ? "FAILED" : "QUEUED", ...(failed ? { payload: plain } : {}) } });
      if (failed) await backToStaff(db, row.requestId, message);
    }
  }
  return sent;
}
