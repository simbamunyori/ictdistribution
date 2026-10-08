import type { Metadata } from "next";
import Link from "next/link";
import { Card, PageHeader, TableWrap, td, th } from "@/components/ui/card";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/zoned";
import { prisma } from "@/server/db";
import { awaitingPayment, customerPayments } from "@/server/portal/accounts";
import { customerInvoices } from "@/server/portal/invoices";
import { portalCan } from "@/server/portal/scope";
import { portalViewer } from "@/server/portal/viewer";
import { PAYMENT_LABEL } from "@/server/shop/orders";

export const metadata: Metadata = { title: "Payments" };

export default async function PaymentsPage() {
  const v = await portalViewer("/account/payments");
  if (!portalCan(v, "accounts")) {
    return (
      <>
        <PageHeader title="Payments" />
        <Card>
          <p>Your role doesn&apos;t include the statement and payments. Ask an Owner or someone in Finance on your team.</p>
        </Card>
      </>
    );
  }
  const [payments, invoices, waiting] = await Promise.all([customerPayments(prisma, v), customerInvoices(prisma, v, new Date(), { open: true }), awaitingPayment(prisma, v)]);
  const toPay = [
    ...waiting.map((o) => ({ key: o.id, what: `Order ${o.number}`, note: "Pro forma: we start once it is paid", reference: o.number, by: o.payBy, owed: o.totalMinor - o.payments.reduce((s, p) => s + p.amountMinor, 0n), currency: o.currency, market: o.market, href: `/orders/${encodeURIComponent(o.number)}/pro-forma` })),
    ...invoices.map((i) => ({ key: i.id, what: `Invoice ${i.number}`, note: i.state === "OVERDUE" ? "Overdue" : "Tax invoice", reference: i.order.number, by: i.dueAt, owed: i.outstanding, currency: i.currency, market: i.order.market, href: `/invoices/${encodeURIComponent(i.number)}` })),
  ];
  return (
    <>
      <PageHeader title="Payments" lead="What is waiting to be paid, how to pay it, and every payment we have received." />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
        <Card>
          <h2 className="text-headline font-bold">To pay</h2>
          {toPay.length ? (
            <ul className="mt-3 divide-y divide-line">
              {toPay.map((t) => (
                <li key={t.key} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <span>
                    <a href={t.href} className="font-semibold text-link underline underline-offset-4">
                      {t.what}
                    </a>
                    <span className="block text-callout text-ink-muted">
                      {t.note}
                      {t.by ? `, by ${formatDate(t.by, t.market.locale, t.market.timeZone)}` : ""}. Reference: {t.reference}
                    </span>
                  </span>
                  <span className={`font-semibold tabular-nums ${t.note === "Overdue" ? "text-negative" : ""}`}>{formatMoney({ amountMinor: t.owed, currency: t.currency }, t.market.locale)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2">Nothing to pay. Thank you.</p>
          )}
          {toPay.length ? <p className="mt-3 text-callout text-ink-muted">Pay by bank transfer with the order number as the reference. The bank details are on each pro forma and tax invoice.</p> : null}
        </Card>

        <Card>
          <h2 className="text-headline font-bold">Received</h2>
          {payments.length ? (
            <TableWrap label="Payments received">
              <table className="mt-3 w-full min-w-[36rem] text-callout">
                <thead>
                  <tr>
                    <th className={th}>Received</th>
                    <th className={th}>For</th>
                    <th className={th}>How</th>
                    <th className={th}>Your reference</th>
                    <th className={`${th} text-right`}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td className={td}>{formatDate(p.receivedOn, p.order.market.locale, p.order.market.timeZone)}</td>
                      <td className={td}>
                        <Link href={`/orders/${encodeURIComponent(p.order.number)}`} className="text-link underline underline-offset-4">
                          {p.order.number}
                        </Link>
                        {p.order.invoice ? <span className="block text-caption text-ink-muted">Invoice {p.order.invoice.number}</span> : null}
                      </td>
                      <td className={td}>{PAYMENT_LABEL[p.method]}</td>
                      <td className={td}>{p.reference}</td>
                      <td className={`${td} text-right tabular-nums`}>{formatMoney({ amountMinor: p.amountMinor, currency: p.order.currency }, p.order.market.locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <p className="mt-2">No payments yet.</p>
          )}
        </Card>
      </div>
    </>
  );
}
