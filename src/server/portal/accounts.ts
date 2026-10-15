import type { PrismaClient } from "@prisma/client";
import { company } from "@/config/app";
import { formatMoney } from "@/lib/money";
import { ageing, buildStatement, type Ageing, type Statement, type StatementItem } from "@/lib/statement";
import { formatDate, fromLocalInput, toLocalInput } from "@/lib/zoned";
import { sheet } from "@/server/documents/pdf-kit";
import { PAYMENT_LABEL } from "@/server/shop/orders";
import { scopeWhere, type PortalViewer } from "./scope";

/**
 * A customer's account with us: payments received, the statement for a
 * period and what is owed by age. Invoices count when issued; payments
 * when received, including those made before an order was sent.
 */

type Db = Pick<PrismaClient, "invoice" | "orderPayment" | "order" | "organisation" | "user">;
type Who = Pick<PortalViewer, "userId" | "organisationId">;

/** Every payment received for the viewer's orders, newest first. */
export async function customerPayments(db: Pick<PrismaClient, "orderPayment">, v: Who) {
  return db.orderPayment.findMany({
    where: { order: scopeWhere(v) },
    orderBy: [{ receivedOn: "desc" }, { createdAt: "desc" }],
    take: 500,
    select: { id: true, method: true, amountMinor: true, reference: true, receivedOn: true, order: { select: { number: true, currency: true, invoice: { select: { number: true } }, market: { select: { locale: true, timeZone: true } } } } },
  });
}

/** Orders waiting for a bank transfer before we start: they have a pro forma invoice, not yet a tax invoice. */
export async function awaitingPayment(db: Pick<PrismaClient, "order">, v: Who) {
  return db.order.findMany({
    where: { ...scopeWhere(v), status: "AWAITING_PAYMENT" },
    orderBy: { createdAt: "asc" },
    select: { id: true, number: true, currency: true, totalMinor: true, payBy: true, payments: { select: { amountMinor: true } }, market: { select: { locale: true, timeZone: true } } },
  });
}

export interface CurrencyStatement extends Statement {
  currency: string;
  ageing: Ageing;
}

export interface CustomerStatement {
  /** Who it is for, one per line. */
  name: string;
  address: string;
  from: Date;
  to: Date;
  locale: string;
  timeZone: string;
  /** One per currency the customer has dealt in; usually one. */
  accounts: CurrencyStatement[];
}

/**
 * The period a statement covers, from yyyy-mm-dd fields read in the
 * customer's time zone: the start of the first day to the end of the
 * last. Empty or wrong fields fall back to the start of the month two
 * months back, to today.
 */
export function statementPeriod(fromInput: string | undefined, toInput: string | undefined, timeZone: string, now = new Date()) {
  const today = toLocalInput(now, timeZone).slice(0, 10);
  const day = (s: string | undefined) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
  let toDay = day(toInput) ?? today;
  if (toDay > today) toDay = today;
  const [y, m] = toDay.split("-").map(Number);
  const back = new Date(Date.UTC(y, m - 3, 1));
  let fromDay = day(fromInput) ?? `${back.getUTCFullYear()}-${String(back.getUTCMonth() + 1).padStart(2, "0")}-01`;
  if (fromDay > toDay) fromDay = toDay;
  const from = fromLocalInput(`${fromDay}T00:00`, timeZone) ?? now;
  const end = fromLocalInput(`${toDay}T23:59`, timeZone);
  const to = end ? new Date(end.getTime() + 59_999) : now;
  return { from, to, fromDay, toDay };
}

/** The statement from the start of `from` to the end of `to`, with what is owed by age at the end of `to`. */
export async function customerStatement(db: Db, v: Who, from: Date, to: Date): Promise<CustomerStatement> {
  const where = scopeWhere(v);
  const [invoices, payments, who] = await Promise.all([
    db.invoice.findMany({ where: { ...where, issuedAt: { lte: to } }, select: { number: true, currency: true, totalMinor: true, issuedAt: true, dueAt: true, orderId: true, order: { select: { number: true, customerReference: true } } } }),
    db.orderPayment.findMany({ where: { order: where, receivedOn: { lte: to } }, select: { amountMinor: true, receivedOn: true, reference: true, method: true, orderId: true, order: { select: { number: true, currency: true } } } }),
    v.organisationId
      ? db.organisation.findUniqueOrThrow({ where: { id: v.organisationId }, select: { name: true, address: true, market: { select: { locale: true, timeZone: true } } } })
      : db.user.findUniqueOrThrow({ where: { id: v.userId }, select: { name: true, email: true, market: { select: { locale: true, timeZone: true } } } }),
  ]);
  const currencies = [...new Set([...invoices.map((i) => i.currency), ...payments.map((p) => p.order.currency)])].sort();
  const accounts = currencies.map((currency) => {
    const items: StatementItem[] = [
      ...invoices.filter((i) => i.currency === currency).map((i) => ({ date: i.issuedAt, kind: "invoice" as const, reference: i.number, details: `Order ${i.order.number}${i.order.customerReference ? `, your reference ${i.order.customerReference}` : ""}`, amountMinor: i.totalMinor })),
      ...payments.filter((p) => p.order.currency === currency).map((p) => ({ date: p.receivedOn, kind: "payment" as const, reference: p.order.number, details: `Payment, ${PAYMENT_LABEL[p.method].toLowerCase()}${p.reference ? `, ${p.reference}` : ""}`, amountMinor: p.amountMinor })),
    ];
    const paidByOrder = new Map<string, bigint>();
    for (const p of payments) paidByOrder.set(p.orderId, (paidByOrder.get(p.orderId) ?? 0n) + p.amountMinor);
    const open = invoices.filter((i) => i.currency === currency).map((i) => ({ dueAt: i.dueAt, outstandingMinor: i.totalMinor - (paidByOrder.get(i.orderId) ?? 0n) }));
    return { currency, ...buildStatement(items, from, to), ageing: ageing(open, to) };
  });
  const market = who.market ?? { locale: company.staffLocale, timeZone: "Africa/Gaborone" };
  return { name: who.name, address: "address" in who ? who.address : who.email, from, to, locale: market.locale, timeZone: market.timeZone, accounts };
}

/** The statement as a PDF. */
export async function statementPdf(st: CustomerStatement, ctx: { appUrl: string; legalName: string; supportEmail?: string | null }): Promise<Uint8Array> {
  const date = (d: Date) => formatDate(d, st.locale, st.timeZone);
  const s = await sheet("Statement", `${date(st.from)} to ${date(st.to)}`);
  s.heading([ctx.legalName, company.domain, ctx.supportEmail ?? ""], [`Date: ${date(st.to)}`]);
  s.party("Statement for", st.name, [st.address.split("\n").join(", ")]);
  if (!st.accounts.length) s.block("Nothing yet", "No invoices or payments up to this date.");
  for (const a of st.accounts) {
    const money = (n: bigint) => formatMoney({ amountMinor: n, currency: a.currency }, st.locale);
    const blank = (n: bigint) => (n ? money(n) : "");
    s.table(
      [
        { label: "Date", width: 70 },
        { label: "Reference", width: 80 },
        { label: "Details", width: 135 },
        { label: "Charged", width: 69, align: "right" },
        { label: "Paid", width: 69, align: "right" },
        { label: "Balance", width: 76, align: "right" },
      ],
      [
        { cells: [date(st.from), "", "Brought forward", "", "", money(a.opening)], bold: true },
        ...a.entries.map((e) => ({ cells: [date(e.date), e.reference, e.details, blank(e.debit), blank(e.credit), money(e.balance)] })),
        { cells: [date(st.to), "", `Balance in ${a.currency}`, money(a.invoiced), money(a.paid), money(a.closing)], bold: true },
      ],
    );
    s.totals([
      ["Not yet due", money(a.ageing.current)],
      ["1 to 30 days late", money(a.ageing.days30)],
      ["31 to 60 days late", money(a.ageing.days60)],
      ["61 to 90 days late", money(a.ageing.days90)],
      ["Over 90 days late", money(a.ageing.older)],
      ["Owed on invoices", money(a.ageing.total)],
    ]);
  }
  s.block("Paying", "Pay by bank transfer with the order number as the reference. The bank details are on each invoice.");
  s.button("See your account online", `${ctx.appUrl}/account/statement`);
  return s.finish();
}
