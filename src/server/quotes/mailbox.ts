import type { PrismaClient } from "@prisma/client";
import { rfqReferenceIn } from "@/lib/quote-reading";
import type { QuoteDeps } from "./common";
import { requestQuoteByEmail, type QuoteFile } from "./intake";
import { applyEmailReply } from "./suppliers";

/**
 * The quotes mailbox (QUOTES_EMAIL, read over IMAP_URL). A reply that
 * carries one of our RFQ references in its subject is a supplier's
 * answer; anything else from a person is a new request for quote. Each
 * message is handled once, by its Message-ID, and marked read.
 */

export interface InboundMail {
  messageId: string;
  from: string;
  name: string;
  subject: string;
  text: string;
  date: Date;
  /** An automatic reply or a bounce: never a request. */
  automatic: boolean;
  attachments: QuoteFile[];
}

/** Requests one address may email in a day. More are kept but not read, so a loop can't flood the queue. */
export const MAX_EMAIL_REQUESTS_PER_DAY = 10;

const ATTACHMENT = /\.(pdf|xlsx|csv)$/i;

type MailDeps = QuoteDeps & { ownAddresses: string[] };

export async function handleInbound(db: PrismaClient, deps: MailDeps, mail: InboundMail): Promise<string> {
  const messageId = mail.messageId.slice(0, 500);
  try {
    await db.inboundEmail.create({ data: { messageId, fromAddress: mail.from.trim().toLowerCase().slice(0, 254), subject: mail.subject.slice(0, 300), outcome: "pending", receivedAt: mail.date } });
  } catch {
    return "seen";
  }
  try {
    const { outcome, ...rest } = await handle(db, deps, mail);
    await db.inboundEmail.update({ where: { messageId }, data: { outcome, quoteId: rest.quoteId, requestId: rest.requestId, note: rest.note ?? "" } });
    return outcome;
  } catch (e) {
    // Not handled after all: the next run tries it again.
    await db.inboundEmail.deleteMany({ where: { messageId, outcome: "pending" } });
    throw e;
  }
}

async function handle(db: PrismaClient, deps: MailDeps, mail: InboundMail): Promise<{ outcome: string; quoteId?: string; requestId?: string; note?: string }> {
  const now = deps.now ?? new Date();
  const from = mail.from.trim().toLowerCase();
  const own = deps.ownAddresses.map((a) => a.toLowerCase());
  if (mail.automatic || !from.includes("@") || own.includes(from) || /^(mailer-daemon|postmaster|no-?reply)@/i.test(from)) return { outcome: "ignored", note: "An automatic message." };

  const reference = rfqReferenceIn(mail.subject);
  if (reference) {
    const result = await applyEmailReply(db, deps, reference, from, mail.text);
    if (result.requestId) return { outcome: "supplier-reply", requestId: result.requestId, note: result.read ? "Prices read." : "Kept for staff to enter." };
  }

  const today = await db.inboundEmail.count({ where: { fromAddress: from, outcome: "quote-request", createdAt: { gt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } } });
  if (today >= MAX_EMAIL_REQUESTS_PER_DAY) return { outcome: "ignored", note: `More than ${MAX_EMAIL_REQUESTS_PER_DAY} requests from this address today.` };
  if (!mail.text.trim() && !mail.attachments.length) return { outcome: "ignored", note: "Nothing in it to quote." };
  const file = mail.attachments.find((a) => ATTACHMENT.test(a.name)) ?? null;
  const quote = await requestQuoteByEmail(db, deps, { from, name: mail.name, subject: mail.subject, text: mail.text, file });
  return { outcome: "quote-request", quoteId: quote.id };
}

/** Reads new mail over IMAP. At most `limit` messages a run; the rest wait for the next. */
export async function pollMailbox(db: PrismaClient, deps: MailDeps, imapUrl: string, limit = 25) {
  const { ImapFlow } = await import("imapflow");
  const { simpleParser } = await import("mailparser");
  const url = new URL(imapUrl);
  const secure = url.protocol === "imaps:";
  const client = new ImapFlow({ host: url.hostname, port: Number(url.port || (secure ? 993 : 143)), secure, auth: { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) }, logger: false });
  await client.connect();
  const handled: string[] = [];
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const found = await client.search({ seen: false }, { uid: true });
      for (const uid of (found || []).slice(0, limit)) {
        try {
          const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
          if (!msg || !msg.source) continue;
          const parsed = await simpleParser(msg.source);
          const sender = parsed.from?.value[0];
          const auto = String(parsed.headers.get("auto-submitted") ?? "no").toLowerCase();
          await handleInbound(db, deps, {
            messageId: parsed.messageId ?? `uid-${uid}-${parsed.date?.getTime() ?? 0}`,
            from: sender?.address ?? "",
            name: sender?.name ?? "",
            subject: parsed.subject ?? "",
            text: parsed.text ?? "",
            date: parsed.date ?? new Date(),
            automatic: auto !== "no" || Boolean(parsed.headers.get("x-autoreply")),
            attachments: parsed.attachments.filter((a) => a.filename && a.size <= 10 * 1024 * 1024).map((a) => ({ name: a.filename!, bytes: new Uint8Array(a.content) })),
          });
          handled.push(String(uid));
        } catch (e) {
          console.error(`Quotes mailbox: message ${uid} failed and stays unread for the next run:`, e);
        }
      }
      if (handled.length) await client.messageFlagsAdd(handled.join(","), ["\\Seen"], { uid: true });
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
  return handled.length;
}
