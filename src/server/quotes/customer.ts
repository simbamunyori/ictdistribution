import type { OrgRole, Prisma, PrismaClient } from "@prisma/client";
import { formatMoney } from "@/lib/money";
import { audit } from "@/server/audit";
import { hashToken } from "@/server/auth/tokens";
import { queueEmail } from "@/server/email/outbox";
import { DomainError } from "@/server/errors";
import { can } from "@/server/org/access";
import { salesAddresses, type QuoteDeps } from "./common";

/**
 * Quotes as customers see them: their lines and prices under our brand,
 * never the supplier, the cost or the margin. A quote opens from the link
 * in its email, or for the signed-in customer it belongs to.
 */

/** Only what a customer may see. */
export const CUSTOMER_QUOTE_INCLUDE = {
  market: true,
  organisation: { select: { name: true } },
  lines: {
    orderBy: { position: "asc" },
    select: {
      id: true,
      position: true,
      description: true,
      mpn: true,
      quantity: true,
      unitPriceMinor: true,
      lineTotalMinor: true,
      leadTimeDays: true,
      product: { select: { slug: true, name: true, status: true, warrantyMonths: true, warrantyTerms: true, brand: { select: { name: true } }, media: { where: { kind: "DATASHEET" }, orderBy: { sortOrder: "asc" }, select: { id: true, alt: true, filename: true } } } },
    },
  },
} satisfies Prisma.QuoteInclude;

/** Internal: never read for a customer. */
export const CUSTOMER_QUOTE_OMIT = { costBaseMinor: true, marginBps: true, reviewReasons: true, accessTokenHash: true, file: true, supplierDeadline: true } satisfies Prisma.QuoteOmit;

export type CustomerQuote = Prisma.QuoteGetPayload<{ include: typeof CUSTOMER_QUOTE_INCLUDE; omit: typeof CUSTOMER_QUOTE_OMIT }>;

export interface QuoteViewer {
  userId: string | null;
  organisationId: string | null;
  role?: OrgRole | null;
}

/** For whoever holds the link from its email. */
export async function quoteByToken(db: Pick<PrismaClient, "quote">, number: string, token: string): Promise<CustomerQuote | null> {
  if (!token) return null;
  const q = await db.quote.findFirst({ where: { number, accessTokenHash: hashToken(token) }, include: CUSTOMER_QUOTE_INCLUDE, omit: CUSTOMER_QUOTE_OMIT });
  return q ?? null;
}

const isTheirs = (q: { userId: string | null; organisationId: string | null }, v: QuoteViewer) => Boolean((v.organisationId && q.organisationId === v.organisationId) || (v.userId && q.userId === v.userId && !q.organisationId));

/** A signed-in customer's own quote: theirs, or their organisation's. */
export async function quoteForCustomer(db: Pick<PrismaClient, "quote">, number: string, v: QuoteViewer): Promise<CustomerQuote | null> {
  const q = await db.quote.findUnique({ where: { number }, include: CUSTOMER_QUOTE_INCLUDE, omit: CUSTOMER_QUOTE_OMIT });
  return q && isTheirs(q, v) ? q : null;
}

export async function customerQuotes(db: Pick<PrismaClient, "quote">, v: QuoteViewer) {
  const or: Prisma.QuoteWhereInput[] = [];
  if (v.userId) or.push({ userId: v.userId, organisationId: null });
  if (v.organisationId) or.push({ organisationId: v.organisationId });
  if (!or.length) return [];
  return db.quote.findMany({ where: { OR: or }, orderBy: { createdAt: "desc" }, take: 100, omit: CUSTOMER_QUOTE_OMIT, include: { market: { select: { locale: true, timeZone: true } } } });
}

/** How the person answering can be trusted: the link from the email, or a member who may buy. */
export interface Answerer {
  token?: string;
  viewer?: QuoteViewer & { name: string };
}

async function answerable(tx: Prisma.TransactionClient, number: string, who: Answerer, now: Date) {
  const q = await tx.quote.findUnique({ where: { number }, include: { market: true } });
  const byLink = Boolean(q && who.token && q.accessTokenHash === hashToken(who.token));
  const byAccount = Boolean(q && who.viewer && isTheirs(q, who.viewer));
  if (!q || (!byLink && !byAccount)) throw new DomainError("not-found", "No such quote.");
  if (byAccount && !byLink && q.organisationId && !(who.viewer?.role && can({ role: who.viewer.role }, "buy"))) throw new DomainError("forbidden", "Your role doesn't allow accepting quotes. Ask an Owner or a Buyer.");
  if (q.status === "ACCEPTED") throw new DomainError("conflict", "This quote is already accepted.");
  if (q.status !== "SENT") throw new DomainError("conflict", "This quote can't be answered now.");
  if (q.validUntil && q.validUntil.getTime() < now.getTime()) throw new DomainError("conflict", "This quote has expired. Ask us for a new one and we will price it again.");
  return q;
}

/** The customer accepts. Sales are told, and D6 turns it into an order. */
export async function acceptQuote(db: PrismaClient, deps: QuoteDeps, number: string, who: Answerer, ip?: string | null) {
  const now = deps.now ?? new Date();
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Quote" WHERE number = ${number} FOR UPDATE`;
    const q = await answerable(tx, number, who, now);
    await tx.quote.update({ where: { id: q.id }, data: { status: "ACCEPTED", acceptedAt: now } });
    const total = q.totalMinor === null ? "" : formatMoney({ amountMinor: q.totalMinor, currency: q.currency }, q.market.locale);
    await queueEmail(tx, deps.key, { to: q.email, kind: "quote.accepted", payload: { number: q.number, name: q.name, total } });
    for (const to of await salesAddresses(tx)) await queueEmail(tx, deps.key, { to, kind: "quote.answered", payload: { number: q.number, customer: q.companyName || q.name, total, outcome: "accepted", quoteId: q.id, reason: "" } });
    const label = who.viewer?.name ?? `${q.name}, by the emailed link`;
    await audit(tx, { actorKind: who.viewer ? "CUSTOMER" : "SYSTEM", actorUserId: who.viewer?.userId ?? null, actorLabel: label, action: "quote.accepted", summary: `Accepted quote ${q.number} for ${total}`, organisationId: q.organisationId, subjectUserId: q.userId, targetType: "Quote", targetId: q.id, visibleToCustomer: Boolean(q.userId || q.organisationId), ipAddress: ip });
    return q;
  });
}

export async function declineQuote(db: PrismaClient, deps: QuoteDeps, number: string, who: Answerer, reasonInput: string, ip?: string | null) {
  const now = deps.now ?? new Date();
  const reason = reasonInput.trim().slice(0, 300);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Quote" WHERE number = ${number} FOR UPDATE`;
    const q = await answerable(tx, number, who, now);
    await tx.quote.update({ where: { id: q.id }, data: { status: "DECLINED", declinedAt: now, declineReason: reason || null } });
    const total = q.totalMinor === null ? "" : formatMoney({ amountMinor: q.totalMinor, currency: q.currency }, q.market.locale);
    for (const to of await salesAddresses(tx)) await queueEmail(tx, deps.key, { to, kind: "quote.answered", payload: { number: q.number, customer: q.companyName || q.name, total, outcome: "declined", quoteId: q.id, reason } });
    const label = who.viewer?.name ?? `${q.name}, by the emailed link`;
    await audit(tx, { actorKind: who.viewer ? "CUSTOMER" : "SYSTEM", actorUserId: who.viewer?.userId ?? null, actorLabel: label, action: "quote.declined", summary: `Declined quote ${q.number}${reason ? `: ${reason}` : ""}`, organisationId: q.organisationId, subjectUserId: q.userId, targetType: "Quote", targetId: q.id, visibleToCustomer: Boolean(q.userId || q.organisationId), ipAddress: ip });
    return q;
  });
}
