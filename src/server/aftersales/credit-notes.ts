import type { Prisma, PrismaClient } from "@prisma/client";
import { company } from "@/config/app";
import { applyBps, formatMoney, parseMoney } from "@/lib/money";
import { taxIncluded } from "@/lib/shop-pricing";
import { formatDate } from "@/lib/zoned";
import { audit, staffAudit } from "@/server/audit";
import { hashToken, newToken } from "@/server/auth/tokens";
import { sheet } from "@/server/documents/pdf-kit";
import { queueEmail } from "@/server/email/outbox";
import { DomainError } from "@/server/errors";
import { inScope, scopeWhere, type PortalViewer } from "@/server/portal/scope";
import { assertStaffCan, type StaffActor } from "@/server/staff/access";

/**
 * Credit notes and refunds. A credit note takes returned items off an
 * order's invoice, numbered CN-100001 onwards: it lowers what is owed,
 * and when the customer has already paid more than is now owed, Finance
 * pays the difference back and records the refund.
 */

type Tx = Prisma.TransactionClient;

export interface CreditLine {
  description: string;
  mpn: string;
  quantity: number;
  /** Per unit, as the order charged it: with tax for shop orders, before tax for orders from quotes. */
  unitMinor: string;
  totalMinor: string;
}

/** What an order comes to after credit notes, against what was received less refunds. */
export interface OrderMoney {
  total: bigint;
  credited: bigint;
  /** The total less credit notes. */
  due: bigint;
  paid: bigint;
  refunded: bigint;
  /** Payments less refunds. */
  settled: bigint;
  /** Still to pay. */
  outstanding: bigint;
  /** Received beyond what is due: ours to pay back. */
  overpaid: bigint;
}

export function orderMoney(total: bigint, payments: { amountMinor: bigint }[], credits: { totalMinor: bigint }[], refunds: { amountMinor: bigint }[]): OrderMoney {
  const sum = (xs: bigint[]) => xs.reduce((s, x) => s + x, 0n);
  const credited = sum(credits.map((c) => c.totalMinor));
  const paid = sum(payments.map((p) => p.amountMinor));
  const refunded = sum(refunds.map((r) => r.amountMinor));
  const due = total - credited;
  const settled = paid - refunded;
  return { total, credited, due, paid, refunded, settled, outstanding: due > settled ? due - settled : 0n, overpaid: settled > due ? settled - due : 0n };
}

export async function moneyFor(db: Tx | Pick<PrismaClient, "order">, orderId: string): Promise<OrderMoney> {
  const o = await db.order.findUniqueOrThrow({ where: { id: orderId }, select: { totalMinor: true, payments: { select: { amountMinor: true } }, creditNotes: { select: { totalMinor: true } }, refunds: { select: { amountMinor: true } } } });
  return orderMoney(o.totalMinor, o.payments, o.creditNotes, o.refunds);
}

/**
 * What crediting these quantities comes to, priced as the order charged
 * them, with the tax in it worked out the way the invoice did.
 */
export function creditFor(o: { pricesIncludeTax: boolean; taxRateBps: number }, items: { description: string; mpn: string; quantity: number; unitPriceMinor: bigint }[]) {
  const lines: CreditLine[] = items.filter((i) => i.quantity > 0).map((i) => ({ description: i.description, mpn: i.mpn, quantity: i.quantity, unitMinor: String(i.unitPriceMinor), totalMinor: String(i.unitPriceMinor * BigInt(i.quantity)) }));
  const lineSum = lines.reduce((s, l) => s + BigInt(l.totalMinor), 0n);
  if (o.pricesIncludeTax) return { lines, totalMinor: lineSum, taxMinor: taxIncluded(lineSum, o.taxRateBps) };
  const tax = applyBps(lineSum, o.taxRateBps);
  return { lines, totalMinor: lineSum + tax, taxMinor: tax };
}

/**
 * Inside a transaction: issues a credit note against the order's invoice
 * and emails it. Settles the order when what was received now covers
 * what is owed. Returns the credit note.
 */
export async function issueCreditNote(tx: Tx, key: string, input: { orderId: string; returnId?: string; lines: CreditLine[]; totalMinor: bigint; taxMinor: bigint; reason: string; actor: StaffActor; now: Date }) {
  const o = await tx.order.findUniqueOrThrow({ where: { id: input.orderId }, include: { invoice: true, market: true, payments: true, creditNotes: true, refunds: true } });
  if (!o.invoice) throw new DomainError("conflict", "This order has no invoice yet, so there is nothing to credit. Cancel it instead.");
  if (input.totalMinor <= 0n) throw new DomainError("invalid", "There is nothing to credit.");
  const before = orderMoney(o.totalMinor, o.payments, o.creditNotes, o.refunds);
  if (input.totalMinor > before.due) throw new DomainError("invalid", "This is more than is left on the invoice after earlier credit notes.");
  const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('credit_note_number_seq') AS n`;
  const token = newToken();
  const note = await tx.creditNote.create({
    data: { number: `CN-${n}`, orderId: o.id, invoiceId: o.invoice.id, returnId: input.returnId ?? null, userId: o.userId, organisationId: o.organisationId, currency: o.currency, totalMinor: input.totalMinor, taxMinor: input.taxMinor, lines: input.lines as unknown as Prisma.InputJsonValue, reason: input.reason, issuedAt: input.now, issuedByLabel: input.actor.name, accessTokenHash: hashToken(token) },
  });
  const after = orderMoney(o.totalMinor, o.payments, [...o.creditNotes, note], o.refunds);
  if (!o.paidAt && after.outstanding === 0n) await tx.order.update({ where: { id: o.id }, data: { paidAt: input.now } });
  const money = (amountMinor: bigint) => formatMoney({ amountMinor, currency: o.currency }, o.market.locale);
  await queueEmail(tx, key, {
    to: o.email,
    kind: "creditnote.issued",
    payload: { number: note.number, invoice: o.invoice.number, order: o.number, total: money(note.totalMinor), outstanding: after.outstanding ? money(after.outstanding) : "", refund: after.overpaid ? money(after.overpaid) : "" },
    secret: { token },
  });
  await audit(tx, staffAudit(input.actor, { action: "creditnote.issued", summary: `Credit note ${note.number} issued against invoice ${o.invoice.number} for order ${o.number}, ${money(note.totalMinor)}`, organisationId: o.organisationId, subjectUserId: o.userId, targetType: "CreditNote", targetId: note.id, visibleToCustomer: true }));
  return note;
}

export interface RefundInput {
  amount: string;
  reference: string;
  /** yyyy-mm-dd */
  paidOn: string;
}

/** Finance records money paid back to a customer who had paid more than is now owed. */
export async function recordRefund(db: PrismaClient, actor: StaffActor, deps: { key: string; now?: Date }, orderId: string, input: RefundInput, ip?: string | null) {
  assertStaffCan(actor, "issueCreditNotes");
  const now = deps.now ?? new Date();
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
    const o = await tx.order.findUnique({ where: { id: orderId }, include: { market: true, creditNotes: { orderBy: { issuedAt: "desc" } } } });
    if (!o) throw new DomainError("not-found", "No such order.");
    const m = await moneyFor(tx, orderId);
    const money = (n: bigint) => formatMoney({ amountMinor: n, currency: o.currency }, o.market.locale);
    if (m.overpaid <= 0n) throw new DomainError("conflict", "Nothing is owed back on this order.");
    let amount: bigint;
    try {
      amount = parseMoney(input.amount, o.currency);
      if (amount <= 0n) throw new Error();
    } catch {
      throw new DomainError("invalid", `Enter the amount paid back in ${o.currency}.`, "amount");
    }
    if (amount > m.overpaid) throw new DomainError("invalid", `Enter up to ${money(m.overpaid)}, what is owed back.`, "amount");
    const paidOn = /^\d{4}-\d{2}-\d{2}$/.test(input.paidOn) ? new Date(`${input.paidOn}T12:00:00Z`) : null;
    if (!paidOn || Number.isNaN(paidOn.getTime()) || paidOn.getTime() > now.getTime() + 86_400_000) throw new DomainError("invalid", "Enter the day it was paid.", "paidOn");
    const reference = input.reference.trim().slice(0, 120);
    await tx.orderRefund.create({ data: { orderId, creditNoteId: o.creditNotes[0]?.id ?? null, amountMinor: amount, reference, paidOn, recordedByLabel: actor.name } });
    await queueEmail(tx, deps.key, { to: o.email, kind: "refund.paid", payload: { order: o.number, amount: money(amount), reference, paidOn: formatDate(paidOn, o.market.locale, o.market.timeZone) } });
    await audit(tx, staffAudit(actor, { action: "order.refund", summary: `Recorded a refund of ${money(amount)} for order ${o.number}${reference ? ` (${reference})` : ""}`, organisationId: o.organisationId, subjectUserId: o.userId, targetType: "Order", targetId: orderId, ipAddress: ip, visibleToCustomer: true }));
  });
}

// ─── Reading ─────────────────────────────────────────────────────────

export const CREDIT_NOTE_INCLUDE = {
  order: { select: { number: true, name: true, email: true, customerReference: true, pricesIncludeTax: true, taxName: true, taxRateBps: true, market: true } },
  invoice: { select: { number: true, billTo: true, taxNumber: true, issuedAt: true } },
  request: { select: { number: true } },
} satisfies Prisma.CreditNoteInclude;

export type FullCreditNote = Prisma.CreditNoteGetPayload<{ include: typeof CREDIT_NOTE_INCLUDE }>;

export async function creditNoteByToken(db: Pick<PrismaClient, "creditNote">, number: string, token: string) {
  if (!token) return null;
  const c = await db.creditNote.findUnique({ where: { number }, include: CREDIT_NOTE_INCLUDE });
  return c && c.accessTokenHash === hashToken(token) ? c : null;
}

export async function creditNoteForViewer(db: Pick<PrismaClient, "creditNote">, number: string, v: Pick<PortalViewer, "userId" | "organisationId">) {
  const c = await db.creditNote.findUnique({ where: { number }, include: CREDIT_NOTE_INCLUDE });
  return c && inScope(v, c) ? c : null;
}

export async function creditNoteByNumber(db: Pick<PrismaClient, "creditNote">, number: string) {
  return db.creditNote.findUnique({ where: { number }, include: CREDIT_NOTE_INCLUDE });
}

/** The viewer's credit notes, newest first. */
export async function customerCreditNotes(db: Pick<PrismaClient, "creditNote">, v: Pick<PortalViewer, "userId" | "organisationId">) {
  return db.creditNote.findMany({ where: scopeWhere(v), orderBy: { issuedAt: "desc" }, take: 500, include: { order: { select: { number: true, market: { select: { locale: true, timeZone: true } } } }, invoice: { select: { number: true } }, request: { select: { number: true } } } });
}

export function creditLines(c: { lines: Prisma.JsonValue }): CreditLine[] {
  return Array.isArray(c.lines) ? (c.lines as unknown as CreditLine[]) : [];
}

/** The credit note as a PDF. */
export async function creditNotePdf(c: FullCreditNote, ctx: { appUrl: string; legalName: string }): Promise<Uint8Array> {
  const o = c.order;
  const { locale, timeZone } = o.market;
  const money = (n: bigint) => formatMoney({ amountMinor: n, currency: c.currency }, locale);
  const date = (d: Date) => formatDate(d, locale, timeZone);
  const s = await sheet("Credit note", c.number);
  s.heading([ctx.legalName, o.market.taxNumber ? `${o.taxName} number ${o.market.taxNumber}` : "", company.domain, o.market.supportEmail ?? ""], [`Date: ${date(c.issuedAt)}`, `Invoice: ${c.invoice.number} of ${date(c.invoice.issuedAt)}`, `Order: ${o.number}`, ...(c.request ? [`Return: ${c.request.number}`] : [])]);
  const [first, ...rest] = c.invoice.billTo.split("\n");
  s.party("Credit to", first ?? "", [rest.join(", "), [c.invoice.taxNumber ? `Tax number ${c.invoice.taxNumber}` : "", o.customerReference ? `Your reference: ${o.customerReference}` : ""].filter(Boolean).join(". "), o.pricesIncludeTax ? `Prices in ${c.currency}, including ${o.taxName}.` : `Prices in ${c.currency}, per unit before ${o.taxName}.`]);
  s.lines(creditLines(c).map((l, i) => ({ n: String(i + 1), description: l.description, sub: l.mpn ? `Part ${l.mpn}` : "", quantity: String(l.quantity), unit: money(BigInt(l.unitMinor)), total: money(BigInt(l.totalMinor)) })));
  s.totals(o.pricesIncludeTax ? [[`Includes ${o.taxName} ${o.taxRateBps / 100}%`, money(c.taxMinor)], ["Credited", money(c.totalMinor)]] : [["Subtotal", money(c.totalMinor - c.taxMinor)], [`${o.taxName} ${o.taxRateBps / 100}%`, money(c.taxMinor)], ["Credited", money(c.totalMinor)]]);
  s.block("Why", c.reason);
  s.block("What happens next", "This credit comes off what you owe us. If you had already paid, we pay the difference back to you and email you when we do.");
  s.button("See your account online", `${ctx.appUrl}/account/invoices`);
  return s.finish();
}
