import { currencyInfo } from "./money";

/**
 * Invoices, credit notes and payments as CSV files the accounting
 * packages import: Xero (sales invoices), QuickBooks Online (invoices)
 * and Sage 50 (audit trail transactions). Pure, so it is easy to test.
 * Every line is exported before tax with its own share of the document's
 * tax, so the package's totals match ours to the cent.
 */

export type ExportFormat = "xero" | "quickbooks" | "sage" | "payments";

export const EXPORT_FORMAT_LABEL: Record<ExportFormat, string> = {
  xero: "Xero: sales invoices and credit notes",
  quickbooks: "QuickBooks Online: invoices and credit memos",
  sage: "Sage 50: invoices, credits and receipts",
  payments: "Payments and refunds, for any package",
};

export const EXPORT_FORMATS = Object.keys(EXPORT_FORMAT_LABEL) as ExportFormat[];

export interface ExportLine {
  description: string;
  quantity: number;
  /** What the document charged for the line: with tax when the prices include it, else before tax. */
  amountMinor: bigint;
}

export interface ExportDoc {
  kind: "invoice" | "credit";
  number: string;
  date: Date;
  dueDate: Date;
  customerName: string;
  accountCode: string;
  email: string;
  /** The order number. */
  reference: string;
  currency: string;
  pricesIncludeTax: boolean;
  taxRateBps: number;
  lines: ExportLine[];
  totalMinor: bigint;
  taxMinor: bigint;
}

export interface ExportPayment {
  kind: "payment" | "refund";
  date: Date;
  orderNumber: string;
  invoiceNumber: string;
  customerName: string;
  accountCode: string;
  reference: string;
  method: string;
  currency: string;
  amountMinor: bigint;
}

export interface ExportCodes {
  salesAccountCode: string;
  taxCode: string;
  zeroTaxCode: string;
  bankAccountCode: string;
}

/** Shares `total` out in proportion to `weights`, the remainder to the largest parts, so the shares add up exactly. */
export function share(total: bigint, weights: bigint[]): bigint[] {
  const sum = weights.reduce((s, w) => s + w, 0n);
  if (sum === 0n) return weights.map((_, i) => (i === 0 ? total : 0n));
  const exact = weights.map((w) => total * w);
  const parts = exact.map((e) => e / sum);
  let left = total - parts.reduce((s, p) => s + p, 0n);
  const order = exact.map((e, i) => ({ i, r: e % sum })).sort((a, b) => (b.r > a.r ? 1 : b.r < a.r ? -1 : a.i - b.i));
  for (const { i } of order) {
    if (left <= 0n) break;
    parts[i] += 1n;
    left -= 1n;
  }
  return parts;
}

export interface NetLine {
  description: string;
  quantity: number;
  /** Before tax, for the whole line. */
  netMinor: bigint;
  taxMinor: bigint;
}

/** Each line before tax with its share of the tax. Net and tax together come to the document's total. */
export function netLines(doc: Pick<ExportDoc, "lines" | "pricesIncludeTax" | "taxMinor">): NetLine[] {
  const taxes = share(
    doc.taxMinor,
    doc.lines.map((l) => l.amountMinor),
  );
  return doc.lines.map((l, i) => ({
    description: l.description,
    quantity: l.quantity,
    netMinor: doc.pricesIncludeTax ? l.amountMinor - taxes[i] : l.amountMinor,
    taxMinor: taxes[i],
  }));
}

/** A minor amount as a plain decimal, such as "-1250.50". */
export function decimal(minor: bigint, currency: string): string {
  const exp = currencyInfo(currency).exponent;
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  if (exp === 0) return `${neg ? "-" : ""}${abs}`;
  const unit = 10n ** BigInt(exp);
  return `${neg ? "-" : ""}${abs / unit}.${(abs % unit).toString().padStart(exp, "0")}`;
}

/** dd/mm/yyyy in the given time zone, as the packages read dates in our markets. */
export function ddmmyyyy(d: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")}`;
}

/** One CSV cell. Text that a spreadsheet would run as a formula is made plain. */
function cell(v: string | number): string {
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: (string | number)[][]): string {
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** Quantity and unit amount when the line divides exactly; else one of the whole line, with the quantity in its description. */
function perUnit(l: NetLine): {
  quantity: number;
  unit: bigint;
  description: string;
} {
  if (l.quantity > 0 && l.netMinor % BigInt(l.quantity) === 0n)
    return {
      quantity: l.quantity,
      unit: l.netMinor / BigInt(l.quantity),
      description: l.description,
    };
  return {
    quantity: 1,
    unit: l.netMinor,
    description: `${l.quantity} x ${l.description}`,
  };
}

const taxCodeFor = (doc: ExportDoc, codes: ExportCodes) => (doc.taxRateBps > 0 ? codes.taxCode : codes.zeroTaxCode);

export function xeroCsv(docs: ExportDoc[], codes: ExportCodes, timeZone: string): string {
  const header = ["*ContactName", "EmailAddress", "*InvoiceNumber", "Reference", "*InvoiceDate", "*DueDate", "*Description", "*Quantity", "*UnitAmount", "*AccountCode", "*TaxType", "TaxAmount", "Currency"];
  const rows = docs.flatMap((doc) => {
    // Xero reads an invoice whose total is below zero as a credit note.
    const sign = doc.kind === "credit" ? -1n : 1n;
    return netLines(doc).map((l) => {
      const u = perUnit(l);
      return [doc.customerName, doc.email, doc.number, doc.reference, ddmmyyyy(doc.date, timeZone), ddmmyyyy(doc.dueDate, timeZone), u.description, u.quantity, decimal(sign * u.unit, doc.currency), codes.salesAccountCode, taxCodeFor(doc, codes), decimal(sign * l.taxMinor, doc.currency), doc.currency];
    });
  });
  return toCsv(header, rows);
}

export function quickbooksCsv(docs: ExportDoc[], codes: ExportCodes, timeZone: string): string {
  const header = ["InvoiceNo", "Customer", "InvoiceDate", "DueDate", "Memo", "Item(Product/Service)", "ItemDescription", "ItemQuantity", "ItemRate", "ItemAmount", "ItemTaxCode", "ItemTaxAmount", "Currency"];
  const rows = docs.flatMap((doc) => {
    const sign = doc.kind === "credit" ? -1n : 1n;
    return netLines(doc).map((l) => {
      const u = perUnit(l);
      return [doc.number, doc.customerName, ddmmyyyy(doc.date, timeZone), ddmmyyyy(doc.dueDate, timeZone), `${doc.kind === "credit" ? "Credit note" : "Order"} ${doc.reference}`, "Sales", u.description, u.quantity, decimal(sign * u.unit, doc.currency), decimal(sign * l.netMinor, doc.currency), taxCodeFor(doc, codes), decimal(sign * l.taxMinor, doc.currency), doc.currency];
    });
  });
  return toCsv(header, rows);
}

/** Sage 50 audit trail transactions: SI for an invoice line, SC for a credit, SR for a receipt. Amounts are positive; the type says which way. */
export function sageCsv(docs: ExportDoc[], payments: ExportPayment[], codes: ExportCodes, timeZone: string): string {
  const header = ["Type", "Account Reference", "Nominal A/C Ref", "Department Code", "Date", "Reference", "Details", "Net Amount", "Tax Code", "Tax Amount", "Exchange Rate", "Extra Reference"];
  const rows: (string | number)[][] = docs.flatMap((doc) => netLines(doc).map((l) => [doc.kind === "credit" ? "SC" : "SI", doc.accountCode, codes.salesAccountCode, "", ddmmyyyy(doc.date, timeZone), doc.number, `${l.quantity} x ${l.description}`.slice(0, 60), decimal(l.netMinor, doc.currency), taxCodeFor(doc, codes), decimal(l.taxMinor, doc.currency), "", doc.reference]));
  // Receipts only: Sage 50 has no import type for money paid back, so refunds are entered by hand from the payments file.
  // T9 is Sage's code for transactions outside the scope of tax.
  for (const p of payments.filter((x) => x.kind === "payment")) rows.push(["SR", p.accountCode, codes.bankAccountCode, "", ddmmyyyy(p.date, timeZone), p.invoiceNumber || p.orderNumber, `Payment ${p.reference}`.trim().slice(0, 60), decimal(p.amountMinor, p.currency), "T9", "0.00", "", p.orderNumber]);
  return toCsv(header, rows);
}

export function paymentsCsv(payments: ExportPayment[], timeZone: string): string {
  const header = ["Date", "Type", "Order", "Invoice", "Customer", "Account", "Reference", "Method", "Amount", "Currency"];
  return toCsv(
    header,
    payments.map((p) => [ddmmyyyy(p.date, timeZone), p.kind === "refund" ? "Refund" : "Payment", p.orderNumber, p.invoiceNumber, p.customerName, p.accountCode, p.reference, p.method, decimal(p.kind === "refund" ? -p.amountMinor : p.amountMinor, p.currency), p.currency]),
  );
}

/** A customer account code from a name when none is set: up to eight letters and digits, upper case. */
export function accountCodeFrom(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[^A-Za-z0-9]/g, "")
      .toUpperCase()
      .slice(0, 8) || "CUSTOMER"
  );
}
