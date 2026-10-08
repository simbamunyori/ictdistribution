import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, PageHeader, TableWrap, td, th } from "@/components/ui/card";
import { formatMoney } from "@/lib/money";
import { INVOICE_STATE_LABEL, INVOICE_STATE_TONE } from "@/lib/statement";
import { formatDate } from "@/lib/zoned";
import { prisma } from "@/server/db";
import { customerInvoices } from "@/server/portal/invoices";
import { portalViewer } from "@/server/portal/viewer";

export const metadata: Metadata = { title: "Invoices" };

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const v = await portalViewer("/account/invoices");
  const open = q.show === "open";
  const invoices = await customerInvoices(prisma, v, new Date(), { open });
  return (
    <>
      <PageHeader title="Invoices" lead={`Tax invoices are made when an order is sent or ready to collect${v.organisationId ? ", for every order your team places" : ""}. Download any of them as a PDF.`} />
      <nav aria-label="Which invoices" className="mb-4 flex gap-2">
        <Link href="/account/invoices" aria-current={open ? undefined : "page"} className={`rounded-full px-3 py-1 text-callout font-semibold ${open ? "text-link" : "bg-surface text-ink"}`}>
          All
        </Link>
        <Link href="/account/invoices?show=open" aria-current={open ? "page" : undefined} className={`rounded-full px-3 py-1 text-callout font-semibold ${open ? "bg-surface text-ink" : "text-link"}`}>
          To pay
        </Link>
      </nav>
      {invoices.length ? (
        <Card>
          <TableWrap label="Invoices">
            <table className="w-full min-w-[40rem] text-callout">
              <thead>
                <tr>
                  <th className={th}>Invoice</th>
                  <th className={th}>Order</th>
                  <th className={th}>Issued</th>
                  <th className={th}>Due</th>
                  <th className={`${th} text-right`}>Total</th>
                  <th className={`${th} text-right`}>Still to pay</th>
                  <th className={th}>State</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((i) => {
                  const { locale, timeZone } = i.order.market;
                  const money = (n: bigint) => formatMoney({ amountMinor: n, currency: i.currency }, locale);
                  return (
                    <tr key={i.id}>
                      <td className={td}>
                        <a href={`/invoices/${encodeURIComponent(i.number)}`} className="font-semibold text-link underline underline-offset-4">
                          {i.number}
                          <span className="sr-only"> (PDF)</span>
                        </a>
                      </td>
                      <td className={td}>
                        <Link href={`/orders/${encodeURIComponent(i.order.number)}`} className="text-link underline underline-offset-4">
                          {i.order.number}
                        </Link>
                        {i.order.customerReference ? <span className="block text-caption text-ink-muted">{i.order.customerReference}</span> : null}
                      </td>
                      <td className={td}>{formatDate(i.issuedAt, locale, timeZone)}</td>
                      <td className={td}>{formatDate(i.dueAt, locale, timeZone)}</td>
                      <td className={`${td} text-right tabular-nums`}>{money(i.totalMinor)}</td>
                      <td className={`${td} text-right tabular-nums`}>{i.outstanding ? money(i.outstanding) : ""}</td>
                      <td className={td}>
                        <Badge tone={INVOICE_STATE_TONE[i.state]}>{INVOICE_STATE_LABEL[i.state]}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      ) : (
        <Card>
          <p>{open ? "Nothing to pay. Thank you." : "No invoices yet. Each order gets one when it is sent or ready to collect."}</p>
        </Card>
      )}
    </>
  );
}
