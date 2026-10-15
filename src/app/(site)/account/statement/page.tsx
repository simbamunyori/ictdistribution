import type { Metadata } from "next";
import { buttonClass } from "@/components/ui/button";
import { Card, PageHeader, TableWrap, td, th } from "@/components/ui/card";
import { inputClass } from "@/components/ui/field";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/zoned";
import { prisma } from "@/server/db";
import { customerStatement, statementPeriod } from "@/server/portal/accounts";
import { portalCan } from "@/server/portal/scope";
import { portalViewer } from "@/server/portal/viewer";
import { shopper } from "@/server/shop/viewer";

export const metadata: Metadata = { title: "Statement" };

export default async function StatementPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const v = await portalViewer("/account/statement");
  if (!portalCan(v, "accounts")) {
    return (
      <>
        <PageHeader title="Statement" />
        <Card>
          <p>Your role doesn&apos;t include the statement and payments. Ask an Owner or someone in Finance on your team.</p>
        </Card>
      </>
    );
  }
  const { market } = await shopper();
  const period = statementPeriod(q.from, q.to, market.timeZone);
  const st = await customerStatement(prisma, v, period.from, period.to);
  const date = (d: Date) => formatDate(d, st.locale, st.timeZone);
  const pdf = `/account/statement/pdf?from=${period.fromDay}&to=${period.toDay}`;
  return (
    <>
      <PageHeader title="Statement" lead={`Invoices and payments for ${st.name}, with the balance after each, and what is owed by how late it is.`} />
      <Card className="mb-6">
        <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="from" className="text-callout font-semibold text-ink">
              From
            </label>
            <input id="from" name="from" type="date" defaultValue={period.fromDay} className={inputClass} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="to" className="text-callout font-semibold text-ink">
              To
            </label>
            <input id="to" name="to" type="date" defaultValue={period.toDay} className={inputClass} />
          </div>
          <button type="submit" className={buttonClass("secondary")}>
            Show
          </button>
          <a href={pdf} className={buttonClass("ghost")}>
            Download as PDF
          </a>
        </form>
      </Card>
      {st.accounts.length ? (
        st.accounts.map((a) => {
          const money = (n: bigint) => formatMoney({ amountMinor: n, currency: a.currency }, st.locale);
          return (
            <div key={a.currency} className="mb-6 grid grid-cols-[minmax(0,1fr)] gap-6">
              <Card>
                <h2 className="text-headline font-bold">{st.accounts.length > 1 ? `In ${a.currency}` : `${date(period.from)} to ${date(period.to)}`}</h2>
                <TableWrap label={`Statement in ${a.currency}`}>
                  <table className="mt-3 w-full min-w-[42rem] text-callout">
                    <thead>
                      <tr>
                        <th className={th}>Date</th>
                        <th className={th}>Reference</th>
                        <th className={th}>Details</th>
                        <th className={`${th} text-right`}>Charged</th>
                        <th className={`${th} text-right`}>Paid or credited</th>
                        <th className={`${th} text-right`}>Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className={td}>{date(period.from)}</td>
                        <td className={td} />
                        <td className={`${td} font-semibold`}>Brought forward</td>
                        <td className={td} />
                        <td className={td} />
                        <td className={`${td} text-right font-semibold tabular-nums`}>{money(a.opening)}</td>
                      </tr>
                      {a.entries.map((e, i) => (
                        <tr key={i}>
                          <td className={td}>{date(e.date)}</td>
                          <td className={td}>{e.kind === "invoice" || e.kind === "credit" ? <a href={`/${e.kind === "invoice" ? "invoices" : "credit-notes"}/${encodeURIComponent(e.reference)}`} className="text-link underline underline-offset-4">{e.reference}</a> : e.reference}</td>
                          <td className={td}>{e.details}</td>
                          <td className={`${td} text-right tabular-nums`}>{e.debit ? money(e.debit) : ""}</td>
                          <td className={`${td} text-right tabular-nums`}>{e.credit ? money(e.credit) : ""}</td>
                          <td className={`${td} text-right tabular-nums`}>{money(e.balance)}</td>
                        </tr>
                      ))}
                      <tr>
                        <td className={td}>{date(period.to)}</td>
                        <td className={td} />
                        <td className={`${td} font-semibold`}>Balance</td>
                        <td className={`${td} text-right font-semibold tabular-nums`}>{money(a.invoiced)}</td>
                        <td className={`${td} text-right font-semibold tabular-nums`}>{money(a.paid)}</td>
                        <td className={`${td} text-right font-bold tabular-nums`}>{money(a.closing)}</td>
                      </tr>
                    </tbody>
                  </table>
                </TableWrap>
                {a.closing < 0n ? <p className="mt-3 text-callout text-ink-muted">A balance below zero is money we hold for orders not yet sent, or to refund.</p> : null}
              </Card>
              <Card>
                <h2 className="text-headline font-bold">Owed on invoices on {date(period.to)}</h2>
                <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                  {(
                    [
                      ["Not yet due", a.ageing.current],
                      ["1 to 30 days late", a.ageing.days30],
                      ["31 to 60 days late", a.ageing.days60],
                      ["61 to 90 days late", a.ageing.days90],
                      ["Over 90 days late", a.ageing.older],
                      ["Total", a.ageing.total],
                    ] as const
                  ).map(([k, n]) => (
                    <div key={k}>
                      <dt className="text-caption font-semibold text-ink-muted uppercase">{k}</dt>
                      <dd className={`text-headline font-bold tabular-nums ${k !== "Not yet due" && k !== "Total" && n > 0n ? "text-negative" : ""}`}>{money(n)}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
            </div>
          );
        })
      ) : (
        <Card>
          <p>No invoices or payments up to {date(period.to)}.</p>
        </Card>
      )}
    </>
  );
}
