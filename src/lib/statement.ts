/**
 * Statements and what is owed, worked out from invoices and refunds (what
 * was charged or paid out) and payments and credit notes (what was
 * received or taken off). Pure, so it is easy to test.
 */

export interface StatementItem {
  date: Date;
  kind: "invoice" | "payment" | "credit" | "refund";
  /** The invoice, credit note or order number. */
  reference: string;
  details: string;
  /** Always positive: an invoice or refund adds it, a payment or credit note takes it off. */
  amountMinor: bigint;
}

export interface StatementEntry extends StatementItem {
  debit: bigint;
  credit: bigint;
  /** What was owed after this entry. Below zero, we hold money in advance. */
  balance: bigint;
}

export interface Statement {
  opening: bigint;
  entries: StatementEntry[];
  /** Invoices and refunds. */
  invoiced: bigint;
  /** Payments and credit notes. */
  paid: bigint;
  closing: bigint;
}

const DAY = 86_400_000;

const ORDER: Record<StatementItem["kind"], number> = { invoice: 0, credit: 1, payment: 2, refund: 3 };

/** Debits before credits on the same day, so a balance never dips below zero for a moment. */
function byDate(a: StatementItem, b: StatementItem) {
  // Payments carry a date only, so compare whole days, then debits first, then the time.
  return Math.floor(a.date.getTime() / DAY) - Math.floor(b.date.getTime() / DAY) || ORDER[a.kind] - ORDER[b.kind] || a.date.getTime() - b.date.getTime() || a.reference.localeCompare(b.reference);
}

export const isDebit = (i: Pick<StatementItem, "kind">) => i.kind === "invoice" || i.kind === "refund";

/** Everything from `from` up to the end of `to`, with the balance carried in from before. */
export function buildStatement(items: StatementItem[], from: Date, to: Date): Statement {
  const signed = (i: StatementItem) => (isDebit(i) ? i.amountMinor : -i.amountMinor);
  const sorted = [...items].sort(byDate);
  const opening = sorted.filter((i) => i.date < from).reduce((s, i) => s + signed(i), 0n);
  let balance = opening;
  let invoiced = 0n;
  let paid = 0n;
  const entries: StatementEntry[] = [];
  for (const i of sorted) {
    if (i.date < from || i.date > to) continue;
    balance += signed(i);
    if (isDebit(i)) invoiced += i.amountMinor;
    else paid += i.amountMinor;
    entries.push({ ...i, debit: isDebit(i) ? i.amountMinor : 0n, credit: isDebit(i) ? 0n : i.amountMinor, balance });
  }
  return { opening, entries, invoiced, paid, closing: balance };
}

export interface Ageing {
  /** Not yet due. */
  current: bigint;
  days30: bigint;
  days60: bigint;
  days90: bigint;
  older: bigint;
  total: bigint;
}

/** What is still owed on each invoice, by how long it has been past its due date at `at`. */
export function ageing(open: { dueAt: Date; outstandingMinor: bigint }[], at: Date): Ageing {
  const a: Ageing = { current: 0n, days30: 0n, days60: 0n, days90: 0n, older: 0n, total: 0n };
  for (const o of open) {
    if (o.outstandingMinor <= 0n) continue;
    const late = Math.floor((at.getTime() - o.dueAt.getTime()) / DAY);
    if (late <= 0) a.current += o.outstandingMinor;
    else if (late <= 30) a.days30 += o.outstandingMinor;
    else if (late <= 60) a.days60 += o.outstandingMinor;
    else if (late <= 90) a.days90 += o.outstandingMinor;
    else a.older += o.outstandingMinor;
    a.total += o.outstandingMinor;
  }
  return a;
}

export type InvoiceState = "PAID" | "DUE" | "OVERDUE";

export function invoiceState(totalMinor: bigint, paidMinor: bigint, dueAt: Date, now: Date): InvoiceState {
  if (paidMinor >= totalMinor) return "PAID";
  return dueAt.getTime() < now.getTime() ? "OVERDUE" : "DUE";
}

export const INVOICE_STATE_LABEL: Record<InvoiceState, string> = { PAID: "Paid", DUE: "To pay", OVERDUE: "Overdue" };
export const INVOICE_STATE_TONE = { PAID: "positive", DUE: "warning", OVERDUE: "negative" } as const;
