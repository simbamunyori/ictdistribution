import type { Prisma, PrismaClient } from "@prisma/client";
import { open, seal } from "@/server/auth/secret-box";
import type { EmailAdapter } from "./adapter";
import { renderEmail } from "./layout";
import { TEMPLATES } from "./templates";

type OutboxClient = { outboundEmail: { create: (args: { data: Prisma.OutboundEmailUncheckedCreateInput }) => Promise<unknown> } };

export interface OutboxSettings {
  appUrl: string;
  legalName: string;
  /** Seals secrets (codes, invitation tokens) while they wait in the queue. */
  key: string;
}

/**
 * Queues an email in the same transaction as the change that caused it,
 * so it goes if and only if the change happened. `secret` values are
 * sealed in the row and wiped once the email is sent.
 */
export async function queueEmail(
  tx: OutboxClient,
  key: string,
  input: { to: string; kind: string; payload?: Record<string, string>; secret?: Record<string, string> },
) {
  if (!TEMPLATES[input.kind]) throw new Error(`No email template called ${input.kind}.`);
  const payload: Record<string, string> = { ...(input.payload ?? {}) };
  if (input.secret) payload.sealed = seal(JSON.stringify(input.secret), key);
  await tx.outboundEmail.create({ data: { toAddress: input.to, kind: input.kind, payload } });
}

const MAX_ATTEMPTS = 6;
/** 1, 2, 4, 8, 16 minutes between tries. */
const backoffMs = (attempt: number) => 60_000 * 2 ** Math.max(0, attempt - 1);

/**
 * Sends what is due. Each row is claimed with a conditional update first,
 * so two workers never send the same email twice.
 */
export async function deliverDue(db: PrismaClient, adapter: EmailAdapter, settings: OutboxSettings, now = new Date(), limit = 50, only: Prisma.OutboundEmailWhereInput = {}): Promise<number> {
  const due = await db.outboundEmail.findMany({ where: { ...only, status: "QUEUED", nextAttemptAt: { lte: now } }, orderBy: { createdAt: "asc" }, take: limit });
  let sent = 0;
  for (const row of due) {
    const claim = await db.outboundEmail.updateMany({
      where: { id: row.id, status: "QUEUED", attempts: row.attempts },
      data: { attempts: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + backoffMs(row.attempts + 1)) },
    });
    if (claim.count !== 1) continue;
    const { sealed, ...plain } = row.payload as Record<string, string>;
    try {
      const secret = sealed ? (JSON.parse(open(sealed, settings.key)) as Record<string, string>) : {};
      const rendered = TEMPLATES[row.kind]?.({ ...plain, ...secret }, { appUrl: settings.appUrl });
      if (!rendered) {
        await db.outboundEmail.update({ where: { id: row.id }, data: { status: "FAILED", lastError: "No longer needed.", payload: plain } });
        continue;
      }
      const { text, html } = renderEmail(rendered.body, settings.appUrl, settings.legalName);
      await adapter.send({ to: row.toAddress, subject: rendered.subject, text, html, ...(rendered.replyTo ? { replyTo: rendered.replyTo } : {}) });
      // The subject of a code email carries the code: keep only the kind of email it was.
      await db.outboundEmail.update({ where: { id: row.id }, data: { status: "SENT", sentAt: now, subject: sealed ? row.kind : rendered.subject, lastError: null, payload: plain } });
      sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message.slice(0, 500) : "Unknown error";
      const failed = row.attempts + 1 >= MAX_ATTEMPTS;
      await db.outboundEmail.update({ where: { id: row.id }, data: { lastError: message, status: failed ? "FAILED" : "QUEUED", ...(failed ? { payload: plain } : {}) } });
    }
  }
  return sent;
}
