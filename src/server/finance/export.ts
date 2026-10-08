import type { PrismaClient } from "@prisma/client";
import { DEFAULT_TIME_ZONE } from "@/config/app";
import { accountCodeFrom, paymentsCsv, quickbooksCsv, sageCsv, xeroCsv, type ExportDoc, type ExportFormat, type ExportLine, type ExportPayment } from "@/lib/accounting-export";
import { creditLines } from "@/server/aftersales/credit-notes";
import { audit, staffAudit } from "@/server/audit";
import { assertStaffCan, type StaffActor } from "@/server/staff/access";
import { PAYMENT_LABEL } from "@/server/shop/orders";
import { financeSettings } from "./settings";

/**
 * The accounting export: invoices and credit notes issued, and payments
 * and refunds, in a period, as a CSV file for Xero, QuickBooks Online or
 * Sage 50. Business customers go under their account code; individuals
 * under the cash sales account set in /admin/finance/settings.
 */

type Db = Pick<PrismaClient, "invoice" | "creditNote" | "orderPayment" | "orderRefund" | "financeSettings">;

const ORDER_SELECT = {
  number: true,
  name: true,
  email: true,
  pricesIncludeTax: true,
  taxRateBps: true,
  deliveryMinor: true,
  fulfilment: true,
  lines: {
    orderBy: { sortOrder: "asc" as const },
    select: { description: true, quantity: true, lineTotalMinor: true },
  },
  organisation: { select: { name: true, accountCode: true } },
};

type Who = {
  name: string;
  email: string;
  organisation: { name: string; accountCode: string } | null;
};

function party(o: Who, cashAccountCode: string) {
  return o.organisation
    ? {
        customerName: o.organisation.name,
        accountCode: o.organisation.accountCode || accountCodeFrom(o.organisation.name),
      }
    : { customerName: o.name, accountCode: cashAccountCode };
}

/** Lines that come to what the document charged; any difference, such as rounding, goes on an adjustment line. */
function balanced(lines: ExportLine[], expected: bigint): ExportLine[] {
  const diff = expected - lines.reduce((s, l) => s + l.amountMinor, 0n);
  return diff === 0n ? lines : [...lines, { description: "Adjustment", quantity: 1, amountMinor: diff }];
}

export async function exportData(db: Db, from: Date, to: Date) {
  const s = await financeSettings(db);
  const [invoices, credits, payments, refunds] = await Promise.all([
    db.invoice.findMany({
      where: { issuedAt: { gte: from, lte: to } },
      orderBy: { issuedAt: "asc" },
      select: {
        number: true,
        issuedAt: true,
        dueAt: true,
        currency: true,
        totalMinor: true,
        taxMinor: true,
        order: { select: ORDER_SELECT },
      },
    }),
    db.creditNote.findMany({
      where: { issuedAt: { gte: from, lte: to } },
      orderBy: { issuedAt: "asc" },
      select: {
        number: true,
        issuedAt: true,
        currency: true,
        totalMinor: true,
        taxMinor: true,
        lines: true,
        order: { select: ORDER_SELECT },
      },
    }),
    db.orderPayment.findMany({
      where: { receivedOn: { gte: from, lte: to } },
      orderBy: { receivedOn: "asc" },
      select: {
        receivedOn: true,
        amountMinor: true,
        reference: true,
        method: true,
        order: {
          select: {
            number: true,
            currency: true,
            name: true,
            email: true,
            invoice: { select: { number: true } },
            organisation: { select: { name: true, accountCode: true } },
          },
        },
      },
    }),
    db.orderRefund.findMany({
      where: { paidOn: { gte: from, lte: to } },
      orderBy: { paidOn: "asc" },
      select: {
        paidOn: true,
        amountMinor: true,
        reference: true,
        order: {
          select: {
            number: true,
            currency: true,
            name: true,
            email: true,
            invoice: { select: { number: true } },
            organisation: { select: { name: true, accountCode: true } },
          },
        },
      },
    }),
  ]);
  const docs: ExportDoc[] = [
    ...invoices.map((i) => {
      const o = i.order;
      const lines: ExportLine[] = o.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        amountMinor: l.lineTotalMinor,
      }));
      if (o.deliveryMinor > 0n)
        lines.push({
          description: o.fulfilment === "DELIVERY" ? "Delivery" : "Collection",
          quantity: 1,
          amountMinor: o.deliveryMinor,
        });
      return {
        kind: "invoice" as const,
        number: i.number,
        date: i.issuedAt,
        dueDate: i.dueAt,
        ...party(o, s.cashAccountCode),
        email: o.email,
        reference: o.number,
        currency: i.currency,
        pricesIncludeTax: o.pricesIncludeTax,
        taxRateBps: o.taxRateBps,
        lines: balanced(lines, o.pricesIncludeTax ? i.totalMinor : i.totalMinor - i.taxMinor),
        totalMinor: i.totalMinor,
        taxMinor: i.taxMinor,
      };
    }),
    ...credits.map((c) => {
      const o = c.order;
      const lines = creditLines(c).map((l) => ({
        description: l.description,
        quantity: l.quantity,
        amountMinor: BigInt(l.totalMinor),
      }));
      return {
        kind: "credit" as const,
        number: c.number,
        date: c.issuedAt,
        dueDate: c.issuedAt,
        ...party(o, s.cashAccountCode),
        email: o.email,
        reference: o.number,
        currency: c.currency,
        pricesIncludeTax: o.pricesIncludeTax,
        taxRateBps: o.taxRateBps,
        lines: balanced(lines, o.pricesIncludeTax ? c.totalMinor : c.totalMinor - c.taxMinor),
        totalMinor: c.totalMinor,
        taxMinor: c.taxMinor,
      };
    }),
  ];
  const money: ExportPayment[] = [
    ...payments.map((p) => ({
      kind: "payment" as const,
      date: p.receivedOn,
      orderNumber: p.order.number,
      invoiceNumber: p.order.invoice?.number ?? "",
      ...party(p.order, s.cashAccountCode),
      reference: p.reference,
      method: PAYMENT_LABEL[p.method],
      currency: p.order.currency,
      amountMinor: p.amountMinor,
    })),
    ...refunds.map((r) => ({
      kind: "refund" as const,
      date: r.paidOn,
      orderNumber: r.order.number,
      invoiceNumber: r.order.invoice?.number ?? "",
      ...party(r.order, s.cashAccountCode),
      reference: r.reference,
      method: "Refund",
      currency: r.order.currency,
      amountMinor: r.amountMinor,
    })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());
  return {
    docs,
    payments: money,
    codes: {
      salesAccountCode: s.salesAccountCode,
      taxCode: s.taxCode,
      zeroTaxCode: s.zeroTaxCode,
      bankAccountCode: s.bankAccountCode,
    },
  };
}

/** The file for one package, and an audit row saying who took it. */
export async function exportFile(db: PrismaClient, actor: StaffActor, format: ExportFormat, from: Date, to: Date, days: { fromDay: string; toDay: string }, ip?: string | null) {
  assertStaffCan(actor, "manageFinance");
  const { docs, payments, codes } = await exportData(db, from, to);
  const tz = DEFAULT_TIME_ZONE;
  const csv = format === "xero" ? xeroCsv(docs, codes, tz) : format === "quickbooks" ? quickbooksCsv(docs, codes, tz) : format === "sage" ? sageCsv(docs, payments, codes, tz) : paymentsCsv(payments, tz);
  const counted = format === "payments" ? `${payments.length} payments and refunds` : format === "sage" ? `${docs.length} invoices and credit notes and ${payments.filter((p) => p.kind === "payment").length} receipts` : `${docs.length} invoices and credit notes`;
  await audit(
    db,
    staffAudit(actor, {
      action: "finance.export",
      summary: `Exported ${counted} from ${days.fromDay} to ${days.toDay} for ${format}`,
      ipAddress: ip,
    }),
  );
  return { csv, filename: `${format}-${days.fromDay}-to-${days.toDay}.csv` };
}
