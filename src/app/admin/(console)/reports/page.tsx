import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, PageHeader, TableWrap, td, th } from "@/components/ui/card";
import { inputClass } from "@/components/ui/field";
import { company, DEFAULT_TIME_ZONE } from "@/config/app";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/money";
import { percent } from "@/lib/reports";
import { formatDate, toLocalInput } from "@/lib/zoned";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { financeReport, type Totals } from "@/server/finance/reports";
import { statementPeriod } from "@/server/portal/accounts";
import { durationText } from "@/server/quotes/staff";
import { staffCan } from "@/server/staff/access";

export const metadata: Metadata = { title: "Reports" };

const right = cn(td, "text-right tabular-nums");

function Section({ title, lead, children }: { title: string; lead?: string; children: React.ReactNode }) {
  return (
    <Card>
      <h2 className="text-headline font-bold">{title}</h2>
      {lead ? <p className="mt-1 text-callout text-ink-muted">{lead}</p> : null}
      <div className="mt-3">{children}</div>
    </Card>
  );
}

function TotalsTable({ label, rows, money, extra }: { label: string; rows: Totals[]; money: (n: bigint) => string; extra?: { heading: string; cell: (r: Totals) => string } }) {
  if (!rows.length) return <p className="text-ink-muted">No sales in this period.</p>;
  return (
    <TableWrap label={label}>
      <table className="w-full min-w-[44rem] text-callout">
        <thead>
          <tr>
            <th className={th}>{label}</th>
            <th className={cn(th, "text-right")}>Orders</th>
            <th className={cn(th, "text-right")}>Sales before tax</th>
            <th className={cn(th, "text-right")}>Landed cost</th>
            <th className={cn(th, "text-right")}>Margin</th>
            <th className={cn(th, "text-right")}>Margin %</th>
            {extra ? <th className={cn(th, "text-right")}>{extra.heading}</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row" className={cn(td, "text-left font-semibold")}>
                {r.label}
              </th>
              <td className={right}>{r.orders}</td>
              <td className={right}>{money(r.sales)}</td>
              <td className={right}>{money(r.cost)}</td>
              <td className={right}>{money(r.margin)}</td>
              <td className={right}>
                {percent(r.marginBps)}
                {r.costedSales !== r.sales && r.marginBps !== null ? <span className="block text-caption text-ink-muted">on {money(r.costedSales)} with a cost</span> : null}
              </td>
              {extra ? <td className={right}>{extra.cell(r)}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

/** Sales, margin, quotes, suppliers, stock and open orders, for a period. */
export default async function Reports({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireStaff();
  if (!staffCan({ staffRole: session.user.staffRole }, "viewReports")) redirect("/admin");
  const sp = await searchParams;
  const now = new Date();
  const period = statementPeriod(sp.from, sp.to, DEFAULT_TIME_ZONE, now);
  const r = await financeReport(prisma, period.from, period.to);
  const locale = company.staffLocale;
  const money = (n: bigint) => formatMoney({ amountMinor: n, currency: r.base }, locale);
  const date = (d: Date) => formatDate(d, locale, DEFAULT_TIME_ZONE);
  const today = toLocalInput(now, DEFAULT_TIME_ZONE).slice(0, 10);
  const back = (days: number) => toLocalInput(new Date(now.getTime() - days * 86_400_000), DEFAULT_TIME_ZONE).slice(0, 10);
  const quick = [
    { label: "This month", from: `${today.slice(0, 8)}01` },
    { label: "Last 30 days", from: back(29) },
    { label: "Last 90 days", from: back(89) },
    { label: "Last 12 months", from: back(364) },
  ];
  const q = r.quotes;
  return (
    <>
      <PageHeader title="Reports" lead={`From ${date(period.from)} to ${date(period.to)}, in ${r.base} at the rate in use on the day of each order. Sales are orders that went ahead, before tax.`} />
      <Card className="mb-6">
        <form method="get" className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="flex flex-col gap-1">
            <label htmlFor="from" className="font-semibold text-ink">
              From
            </label>
            <input id="from" name="from" type="date" defaultValue={period.fromDay} className={inputClass} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="to" className="font-semibold text-ink">
              To
            </label>
            <input id="to" name="to" type="date" defaultValue={period.toDay} className={inputClass} />
          </div>
          <Button type="submit" variant="secondary">
            Show
          </Button>
        </form>
        <nav aria-label="Quick periods" className="mt-4 flex flex-wrap gap-2 text-callout">
          {quick.map((p) => (
            <Link key={p.label} href={`/admin/reports?from=${p.from}&to=${today}`} aria-current={period.fromDay === p.from && period.toDay === today ? "page" : undefined} className={cn("rounded-md border border-line px-3 py-2 font-semibold hover:bg-surface", period.fromDay === p.from && period.toDay === today && "border-brand bg-surface")}>
              {p.label}
            </Link>
          ))}
        </nav>
      </Card>
      {r.unconverted.length ? <p className="mb-6 rounded-md border border-line bg-surface p-3 text-callout">Left out for want of an exchange rate: sales in {r.unconverted.join(", ")}. Add a rate in Exchange rates.</p> : null}
      <div className="flex flex-col gap-6">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {[
            ["Sales before tax", money(r.total.sales)],
            ["Margin", money(r.total.margin)],
            ["Margin %", percent(r.total.marginBps) || "None yet"],
            ["Orders", String(r.total.orders)],
            ["Credited", money(r.credited)],
          ].map(([k, v]) => (
            <Card key={k}>
              <dt className="text-callout font-semibold text-ink-muted">{k}</dt>
              <dd className="mt-1 text-title font-bold tabular-nums">{v}</dd>
            </Card>
          ))}
        </dl>
        <Section title="By market" lead="Credited is credit notes issued in the period, before tax, whichever period the order was in.">
          <TotalsTable
            label="Market"
            rows={r.byMarket}
            money={money}
            extra={{
              heading: "Credited",
              cell: (row) => money((row as Totals & { credited: bigint }).credited),
            }}
          />
        </Section>
        <Section title="By category" lead="Delivery charged to customers has no cost against it.">
          <TotalsTable label="Category" rows={r.byCategory} money={money} />
        </Section>
        <Section title="By customer type">
          <TotalsTable label="Customer type" rows={r.byCustomerType} money={money} />
        </Section>
        <Section title="By supplier" lead="The supplier each line was bought from. For staff only: never shown to customers.">
          <TotalsTable label="Supplier" rows={r.bySupplier} money={money} />
        </Section>
        <Section title="Top customers">
          <TotalsTable label="Customer" rows={r.topCustomers} money={money} />
        </Section>
        <Section title="Margin per order" lead="Newest first, up to 100. An order with a line without a recorded cost shows no margin.">
          {r.byOrder.length ? (
            <TableWrap label="Margin per order">
              <table className="w-full min-w-[44rem] text-callout">
                <thead>
                  <tr>
                    <th className={th}>Order</th>
                    <th className={th}>Customer</th>
                    <th className={cn(th, "text-right")}>Sales before tax</th>
                    <th className={cn(th, "text-right")}>Landed cost</th>
                    <th className={cn(th, "text-right")}>Margin %</th>
                  </tr>
                </thead>
                <tbody>
                  {r.byOrder.map((o) => (
                    <tr key={o.id}>
                      <td className={td}>
                        <Link href={`/admin/orders/${o.id}`} className="font-semibold text-link underline underline-offset-4">
                          {o.number}
                        </Link>
                        <span className="block text-ink-muted">{date(o.createdAt)}</span>
                      </td>
                      <td className={td}>{o.customer}</td>
                      <td className={right}>{money(o.sales)}</td>
                      <td className={right}>{o.costed ? money(o.cost) : "Not recorded"}</td>
                      <td className={right}>{percent(o.marginBps)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <p className="text-ink-muted">No sales in this period.</p>
          )}
        </Section>
        <Section title="Quotes" lead="Requests made in the period. Won is accepted; lost is declined or expired without an answer.">
          <dl className="grid gap-4 text-callout sm:grid-cols-3 lg:grid-cols-6">
            {[
              ["Requests", String(q.total.requests)],
              ["Quotes sent", String(q.total.sent)],
              ["Sent by itself", String(q.total.automatic)],
              ["Win rate", q.total.winRate === null ? "None yet" : `${Math.round(q.total.winRate * 100)}%`],
              ["Middle response time", q.medianMs === null ? "None yet" : durationText(q.medianMs)],
              ["Average response time", q.averageMs === null ? "None yet" : durationText(q.averageMs)],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="font-semibold text-ink-muted">{k}</dt>
                <dd className="text-headline font-bold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-callout">
            <Link href="/admin/quotes/report" className="text-link underline underline-offset-4">
              Win rate by type and category
            </Link>
          </p>
        </Section>
        <Section title="Supplier performance" lead="Purchase orders and requests for price made in the period. On time is shipped by the date the supplier gave, with a day's grace.">
          {r.suppliers.length ? (
            <TableWrap label="Supplier performance">
              <table className="w-full min-w-[52rem] text-callout">
                <thead>
                  <tr>
                    <th className={th}>Supplier</th>
                    <th className={cn(th, "text-right")}>Purchase orders</th>
                    <th className={cn(th, "text-right")}>Confirms in</th>
                    <th className={cn(th, "text-right")}>Ships in</th>
                    <th className={cn(th, "text-right")}>On time</th>
                    <th className={cn(th, "text-right")}>Price requests answered</th>
                    <th className={cn(th, "text-right")}>Answers in</th>
                  </tr>
                </thead>
                <tbody>
                  {r.suppliers.map((s) => (
                    <tr key={s.name}>
                      <th scope="row" className={cn(td, "text-left font-semibold")}>
                        {s.name}
                      </th>
                      <td className={right}>{s.purchaseOrders}</td>
                      <td className={right}>{s.confirmHours === null ? "" : `${s.confirmHours} h`}</td>
                      <td className={right}>{s.shipDays === null ? "" : `${s.shipDays} ${s.shipDays === 1 ? "day" : "days"}`}</td>
                      <td className={right}>{s.onTime + s.late ? `${s.onTime} of ${s.onTime + s.late}` : ""}</td>
                      <td className={right}>{s.priceRequests ? `${s.answered} of ${s.priceRequests}` : ""}</td>
                      <td className={right}>{s.answerHours === null ? "" : `${s.answerHours} h`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <p className="text-ink-muted">No purchase orders or price requests in this period.</p>
          )}
          <p className="mt-3 text-callout text-ink-muted">Times are the middle value: half are quicker.</p>
        </Section>
        <Section title="Stock" lead="What we hold now, at each product's landed cost.">
          <p className="mb-3 font-semibold">
            {r.stock.total.units} units worth {money(r.stock.total.value)}
            {r.stock.total.uncosted ? `, and ${r.stock.total.uncosted} units without a cost` : ""}.
          </p>
          {r.stock.byWarehouse.length ? (
            <TableWrap label="Stock by warehouse and category">
              <table className="w-full min-w-[32rem] text-callout">
                <thead>
                  <tr>
                    <th className={th}>Warehouse or category</th>
                    <th className={cn(th, "text-right")}>Units</th>
                    <th className={cn(th, "text-right")}>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ...r.stock.byWarehouse.map((x) => ({
                      ...x,
                      kind: "Warehouse",
                    })),
                    ...r.stock.byCategory.map((x) => ({
                      ...x,
                      kind: "Category",
                    })),
                  ].map((x) => (
                    <tr key={`${x.kind}-${x.label}`}>
                      <th scope="row" className={cn(td, "text-left")}>
                        <span className="font-semibold">{x.label}</span>
                        <span className="block text-caption text-ink-muted">{x.kind}</span>
                      </th>
                      <td className={right}>{x.units}</td>
                      <td className={right}>{money(x.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : null}
        </Section>
        <Section title="Open orders" lead="Orders not yet sent, whenever placed, before tax.">
          <TableWrap label="Open orders">
            <table className="w-full min-w-[32rem] text-callout">
              <thead>
                <tr>
                  <th className={th}>State</th>
                  <th className={cn(th, "text-right")}>Orders</th>
                  <th className={cn(th, "text-right")}>Value</th>
                  <th className={cn(th, "text-right")}>Oldest</th>
                </tr>
              </thead>
              <tbody>
                {r.open.map((o) => (
                  <tr key={o.status}>
                    <th scope="row" className={cn(td, "text-left font-semibold")}>
                      <Link href={`/admin/orders?status=${o.status}`} className="text-link underline underline-offset-4">
                        {o.label}
                      </Link>
                    </th>
                    <td className={right}>{o.count}</td>
                    <td className={right}>{money(o.value)}</td>
                    <td className={right}>{o.oldestDays === null ? "" : `${o.oldestDays} ${o.oldestDays === 1 ? "day" : "days"}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Section>
      </div>
    </>
  );
}
