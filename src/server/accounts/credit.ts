import type { Prisma, PrismaClient } from "@prisma/client";
import { formatMoney, parseMoney } from "@/lib/money";
import { audit, staffAudit } from "@/server/audit";
import { queueEmail } from "@/server/email/outbox";
import { DomainError } from "@/server/errors";
import { assertCan, type Actor } from "@/server/org/access";
import { assertStaffCan, type StaffActor } from "@/server/staff/access";

/**
 * Credit for approved businesses. They apply; Finance sets a limit and
 * terms (days to pay). Orders on account count against the limit until
 * paid, and an order that would take the balance over it is refused.
 * Amounts are in the organisation's market currency.
 */

type Db = Pick<PrismaClient, "$queryRaw" | "organisation">;
type Member = Actor & { organisationId: string };

export const MAX_TERMS_DAYS = 120;

/** What is owed on account: orders not cancelled, less payments received for them. */
export async function accountBalance(db: Pick<PrismaClient, "$queryRaw"> | Prisma.TransactionClient, organisationId: string, now = new Date()) {
  const [row] = await db.$queryRaw<{ owed: bigint | null; overdue: bigint | null }[]>`
    SELECT
      SUM(GREATEST(o."totalMinor" - COALESCE(p.paid, 0), 0))::bigint AS owed,
      SUM(CASE WHEN o."payBy" < ${now} THEN GREATEST(o."totalMinor" - COALESCE(p.paid, 0), 0) ELSE 0 END)::bigint AS overdue
    FROM "Order" o
    LEFT JOIN (SELECT "orderId", SUM("amountMinor")::bigint AS paid FROM "OrderPayment" GROUP BY "orderId") p ON p."orderId" = o.id
    WHERE o."organisationId" = ${organisationId} AND o."paymentMethod" = 'ACCOUNT' AND o.status <> 'CANCELLED'`;
  const clamp = (n: bigint | null) => (n && n > 0n ? n : 0n);
  return { owed: clamp(row?.owed ?? null), overdue: clamp(row?.overdue ?? null) };
}

export interface CreditPosition {
  currency: string;
  locale: string;
  limit: bigint | null;
  termsDays: number | null;
  onHold: boolean;
  owed: bigint;
  overdue: bigint;
  /** What can still be bought on account now. */
  available: bigint;
  /** Whether a new order on account can be placed at all. */
  open: boolean;
}

export async function creditPosition(db: Db, organisationId: string, now = new Date()): Promise<CreditPosition> {
  const org = await db.organisation.findUniqueOrThrow({ where: { id: organisationId }, include: { market: { select: { currency: true, locale: true } } } });
  const { owed, overdue } = await accountBalance(db, organisationId, now);
  const limit = org.verification === "APPROVED" ? org.creditLimitMinor : null;
  const available = limit !== null && limit > owed ? limit - owed : 0n;
  return { currency: org.market.currency, locale: org.market.locale, limit, termsDays: org.creditTermsDays, onHold: org.creditOnHold, owed, overdue, available, open: limit !== null && !org.creditOnHold && org.creditTermsDays !== null && available > 0n };
}

/**
 * Inside the order's transaction: locks the organisation's row so two
 * orders can't both use the last of the limit, then checks this one fits.
 * Returns the terms in days.
 */
export async function reserveCredit(tx: Prisma.TransactionClient, organisationId: string, amount: bigint, now: Date): Promise<number> {
  await tx.$queryRaw`SELECT id FROM "Organisation" WHERE id = ${organisationId} FOR UPDATE`;
  const org = await tx.organisation.findUniqueOrThrow({ where: { id: organisationId }, include: { market: { select: { currency: true, locale: true } } } });
  if (org.verification !== "APPROVED" || org.creditLimitMinor === null || org.creditTermsDays === null) throw new DomainError("invalid", "Your organisation has no credit account. Choose bank transfer, or apply for credit.", "paymentMethod");
  if (org.creditOnHold) throw new DomainError("invalid", "Your credit account is on hold. Contact us, or choose bank transfer.", "paymentMethod");
  const { owed } = await accountBalance(tx, organisationId, now);
  if (owed + amount > org.creditLimitMinor) {
    const left = org.creditLimitMinor > owed ? org.creditLimitMinor - owed : 0n;
    throw new DomainError("invalid", `This order is more than your available credit of ${formatMoney({ amountMinor: left, currency: org.market.currency }, org.market.locale)}. Pay what is owed, or choose bank transfer.`, "paymentMethod");
  }
  return org.creditTermsDays;
}

function checkTerms(limitInput: string, termsInput: string, currency: string) {
  const fieldErrors: Record<string, string> = {};
  let limit = 0n;
  try {
    limit = parseMoney(limitInput, currency);
    if (limit <= 0n) throw new Error();
  } catch {
    fieldErrors.limit = `Enter an amount in ${currency}.`;
  }
  const terms = Number(termsInput);
  if (!Number.isInteger(terms) || terms < 1 || terms > MAX_TERMS_DAYS) fieldErrors.termsDays = `Enter a number of days from 1 to ${MAX_TERMS_DAYS}.`;
  return { limit, terms, fieldErrors };
}

async function notify(tx: Prisma.TransactionClient, key: string, organisationId: string, kind: string, payload: Record<string, string>) {
  const people = await tx.membership.findMany({ where: { organisationId, active: true, role: { in: ["OWNER", "FINANCE"] } }, select: { user: { select: { email: true } } } });
  for (const p of people) await queueEmail(tx, key, { to: p.user.email, kind, payload });
}

// ─── Customers ───────────────────────────────────────────────────────

export interface CreditApplicationInput {
  limit: string;
  termsDays: string;
  details: string;
}

export async function applyForCredit(db: PrismaClient, actor: Member, input: CreditApplicationInput, ip?: string | null) {
  assertCan(actor, "finance");
  await db.$transaction(async (tx) => {
    const org = await tx.organisation.findUniqueOrThrow({ where: { id: actor.organisationId }, include: { market: true } });
    if (org.verification !== "APPROVED") throw new DomainError("invalid", "We need to check your business first. Send your company details and documents.");
    if (await tx.creditApplication.findFirst({ where: { organisationId: org.id, status: "PENDING" } })) throw new DomainError("conflict", "Your application is with Finance already.");
    const { limit, terms, fieldErrors } = checkTerms(input.limit, input.termsDays, org.market.currency);
    const details = input.details.trim();
    if (details.length < 20 || details.length > 2000) fieldErrors.details = "Tell us your usual monthly spend and two trade references, with contact details.";
    if (Object.keys(fieldErrors).length) throw new DomainError("invalid", "Check the highlighted fields.", undefined, fieldErrors);
    const app = await tx.creditApplication.create({ data: { organisationId: org.id, requestedLimitMinor: limit, requestedTermsDays: terms, details, appliedByLabel: actor.name } });
    await audit(tx, { actorKind: "CUSTOMER", actorUserId: actor.userId, actorLabel: actor.name, organisationId: org.id, visibleToCustomer: true, action: "credit.applied", summary: `Applied for credit of ${formatMoney({ amountMinor: limit, currency: org.market.currency }, org.market.locale)} on ${terms} days`, targetType: "CreditApplication", targetId: app.id, ipAddress: ip });
  });
}

// ─── Finance ─────────────────────────────────────────────────────────

export async function pendingCreditApplications(db: Pick<PrismaClient, "creditApplication">) {
  return db.creditApplication.findMany({ where: { status: "PENDING" }, include: { organisation: { select: { id: true, name: true, market: { select: { currency: true, locale: true, timeZone: true } } } } }, orderBy: { createdAt: "asc" } });
}

export interface CreditDecisionInput {
  approve: boolean;
  limit: string;
  termsDays: string;
  note: string;
}

export async function decideCredit(db: PrismaClient, actor: StaffActor, deps: { key: string; now?: Date }, applicationId: string, input: CreditDecisionInput, ip?: string | null) {
  assertStaffCan(actor, "manageCredit");
  await db.$transaction(async (tx) => {
    const app = await tx.creditApplication.findUnique({ where: { id: applicationId }, include: { organisation: { include: { market: true } } } });
    if (!app) throw new DomainError("not-found", "No such application.");
    if (app.status !== "PENDING") throw new DomainError("conflict", "This application has been decided.");
    const org = app.organisation;
    const note = input.note.trim().slice(0, 500);
    const money = (n: bigint) => formatMoney({ amountMinor: n, currency: org.market.currency }, org.market.locale);
    if (input.approve) {
      const { limit, terms, fieldErrors } = checkTerms(input.limit, input.termsDays, org.market.currency);
      if (Object.keys(fieldErrors).length) throw new DomainError("invalid", "Check the highlighted fields.", undefined, fieldErrors);
      await tx.organisation.update({ where: { id: org.id }, data: { creditLimitMinor: limit, creditTermsDays: terms, creditOnHold: false } });
      await tx.creditApplication.update({ where: { id: app.id }, data: { status: "APPROVED", decidedAt: deps.now ?? new Date(), decidedByLabel: actor.name, decisionNote: note || null } });
      await notify(tx, deps.key, org.id, "credit.approved", { organisation: org.name, limit: money(limit), terms: String(terms), note });
      await audit(tx, staffAudit(actor, { organisationId: org.id, visibleToCustomer: true, action: "credit.approved", summary: `Approved credit of ${money(limit)} on ${terms} days`, targetType: "CreditApplication", targetId: app.id, ipAddress: ip }));
    } else {
      if (note.length < 5) throw new DomainError("invalid", "Say why, for the customer.", "note");
      await tx.creditApplication.update({ where: { id: app.id }, data: { status: "DECLINED", decidedAt: deps.now ?? new Date(), decidedByLabel: actor.name, decisionNote: note } });
      await notify(tx, deps.key, org.id, "credit.declined", { organisation: org.name, note });
      await audit(tx, staffAudit(actor, { organisationId: org.id, visibleToCustomer: true, action: "credit.declined", summary: `Declined the credit application: ${note}`, targetType: "CreditApplication", targetId: app.id, ipAddress: ip }));
    }
  });
}

export interface CreditTermsInput {
  /** Empty removes credit. */
  limit: string;
  termsDays: string;
  onHold: boolean;
}

/** Finance changes an account's credit directly: a new limit, other terms, or a hold. */
export async function setCreditTerms(db: PrismaClient, actor: StaffActor, organisationId: string, input: CreditTermsInput, ip?: string | null) {
  assertStaffCan(actor, "manageCredit");
  await db.$transaction(async (tx) => {
    const org = await tx.organisation.findUnique({ where: { id: organisationId }, include: { market: true } });
    if (!org) throw new DomainError("not-found", "No such customer.");
    const money = (n: bigint) => formatMoney({ amountMinor: n, currency: org.market.currency }, org.market.locale);
    if (!input.limit.trim()) {
      await tx.organisation.update({ where: { id: org.id }, data: { creditLimitMinor: null, creditTermsDays: null, creditOnHold: false } });
      await audit(tx, staffAudit(actor, { organisationId: org.id, visibleToCustomer: true, action: "credit.removed", summary: "Closed the credit account", ipAddress: ip }));
      return;
    }
    if (org.verification !== "APPROVED") throw new DomainError("invalid", "Approve the business before giving it credit.");
    const { limit, terms, fieldErrors } = checkTerms(input.limit, input.termsDays, org.market.currency);
    if (Object.keys(fieldErrors).length) throw new DomainError("invalid", "Check the highlighted fields.", undefined, fieldErrors);
    await tx.organisation.update({ where: { id: org.id }, data: { creditLimitMinor: limit, creditTermsDays: terms, creditOnHold: input.onHold } });
    await audit(tx, staffAudit(actor, { organisationId: org.id, visibleToCustomer: true, action: "credit.changed", summary: `Credit set to ${money(limit)} on ${terms} days${input.onHold ? ", on hold" : ""}`, ipAddress: ip }));
  });
}
