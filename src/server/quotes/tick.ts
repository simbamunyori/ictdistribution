import type { PrismaClient } from "@prisma/client";
import { formatDateTime } from "@/lib/zoned";
import { audit, SYSTEM_ACTOR } from "@/server/audit";
import { queueEmail } from "@/server/email/outbox";
import { HOUR, OPEN_STATUSES, quoteSettings, salesAddresses, staffWhen, type QuoteDeps } from "./common";
import { readQuote } from "./intake";
import { priceQuote, startPricing } from "./pricing";

/**
 * The quotes job, every few minutes and straight after a request or an
 * answer arrives: reads new requests, closes supplier requests whose
 * deadline has passed and prices the quotes that were waiting on them,
 * expires quotes nobody accepted in time, and reminds Sales of tenders
 * about to close. Each step claims its rows, so two runs never clash.
 */
export async function quoteTick(db: PrismaClient, deps: QuoteDeps) {
  const now = deps.now ?? new Date();
  const done = { read: 0, priced: 0, expired: 0, reminded: 0 };

  for (const q of await db.quote.findMany({ where: { status: "RECEIVED", readAt: null }, orderBy: { createdAt: "asc" }, take: 20, select: { id: true } })) {
    try {
      if (await readQuote(db, deps, q.id)) done.read++;
    } catch (e) {
      console.error(`Reading quote ${q.id} failed; it will be tried again:`, e);
    }
  }
  // Read, but pricing didn't start (the server stopped between the two).
  for (const q of await db.quote.findMany({ where: { status: "RECEIVED", readAt: { lt: new Date(now.getTime() - 10 * 60_000) }, lines: { some: {} } }, take: 20, select: { id: true } })) await startPricing(db, deps, q.id);

  await db.supplierPriceRequest.updateMany({ where: { status: { in: ["SENT", "TO_SEND_BY_HAND"] }, deadline: { lt: now } }, data: { status: "EXPIRED" } });
  for (const q of await db.quote.findMany({ where: { status: "WAITING_ON_SUPPLIERS", priceRequests: { none: { status: { in: ["SENT", "TO_SEND_BY_HAND"] } } } }, take: 50, select: { id: true } })) {
    await priceQuote(db, deps, q.id, { decide: true });
    done.priced++;
  }

  for (const q of await db.quote.findMany({ where: { status: "SENT", validUntil: { lt: now } }, take: 100, select: { id: true, number: true, organisationId: true, userId: true } })) {
    const n = await db.quote.updateMany({ where: { id: q.id, status: "SENT" }, data: { status: "EXPIRED" } });
    if (n.count) {
      await audit(db, { ...SYSTEM_ACTOR, action: "quote.expired", summary: `Quote ${q.number} ran out without being accepted`, organisationId: q.organisationId, subjectUserId: q.userId, targetType: "Quote", targetId: q.id, visibleToCustomer: Boolean(q.userId || q.organisationId) });
      done.expired++;
    }
  }

  const settings = await quoteSettings(db);
  const closing = await db.quote.findMany({ where: { type: "TENDER", status: { in: OPEN_STATUSES }, reminderSentAt: null, tenderDeadline: { gt: now, lte: new Date(now.getTime() + settings.tenderReminderHours * HOUR) } }, include: { market: true } });
  for (const q of closing) {
    await db.$transaction(async (tx) => {
      const n = await tx.quote.updateMany({ where: { id: q.id, reminderSentAt: null }, data: { reminderSentAt: now } });
      if (!n.count) return;
      for (const to of await salesAddresses(tx)) await queueEmail(tx, deps.key, { to, kind: "quote.tender-reminder", payload: { number: q.number, tender: q.tenderReference, closes: staffWhen(q.tenderDeadline!), closesThere: `${formatDateTime(q.tenderDeadline!, q.market.locale, q.market.timeZone)} in ${q.market.name}`, quoteId: q.id, documents: q.requiredDocuments } });
      await audit(tx, { ...SYSTEM_ACTOR, action: "quote.tender-reminder", summary: `Reminded Sales that tender ${q.tenderReference} (quote ${q.number}) closes ${staffWhen(q.tenderDeadline!)}`, targetType: "Quote", targetId: q.id });
      done.reminded++;
    });
  }
  return done;
}
