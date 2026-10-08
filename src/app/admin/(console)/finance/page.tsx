import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { sendReminderAction } from "@/app/admin/(console)/finance-actions";
import { ActionForm } from "@/components/ui/action-form";
import { Badge, Card, PageHeader, TableWrap, td, th } from "@/components/ui/card";
import { company, DEFAULT_TIME_ZONE } from "@/config/app";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/money";
import { AGE_BAND_LABEL, AGE_BANDS, type AgeBand } from "@/lib/reports";
import { formatDate } from "@/lib/zoned";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { openInvoices } from "@/server/finance/reminders";
import { financeSettings } from "@/server/finance/settings";
import { staffCan } from "@/server/staff/access";

export const metadata: Metadata = { title: "Finance" };

const BAND_TONE: Record<AgeBand, "neutral" | "warning" | "negative"> = {
  current: "neutral",
  d1_30: "warning",
  d31_60: "negative",
  d61_90: "negative",
  d90: "negative",
};

/** What customers owe us, by age, and chasing it. */
export default async function Finance({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireStaff();
  if (!staffCan({ staffRole: session.user.staffRole }, "manageFinance")) redirect("/admin");
  const show = (await searchParams).show === "all" ? "all" : "overdue";
  const now = new Date();
  const [open, s] = await Promise.all([openInvoices(prisma, now), financeSettings(prisma)]);
  const locale = company.staffLocale;
  const money = (amountMinor: bigint, currency: string) => formatMoney({ amountMinor, currency }, locale);
  const date = (d: Date) => formatDate(d, locale, DEFAULT_TIME_ZONE);
  const currencies = [...new Set(open.map((i) => i.currency))].sort();
  const rows = show === "all" ? open : open.filter((i) => i.daysOverdue > 0);
  return (
    <>
      <PageHeader
        title="Finance"
        lead={s.remindersOn ? `Overdue invoices are chased by email ${s.firstReminderDays} days after their due date, then every ${s.reminderEveryDays} days, up to ${s.maxReminders} times.` : "Overdue reminders are off. Turn them on in the finance settings."}
        actions={
          <div className="flex flex-wrap gap-3 text-callout font-semibold">
            <Link href="/admin/finance/export" className="text-link underline underline-offset-4">
              Export to accounting
            </Link>
            <Link href="/admin/finance/settings" className="text-link underline underline-offset-4">
              Finance settings
            </Link>
            <Link href="/admin/reports" className="text-link underline underline-offset-4">
              Reports
            </Link>
          </div>
        }
      />
      <div className="flex flex-col gap-6">
        <Card>
          <h2 className="mb-3 text-headline font-bold">Owed to us</h2>
          {currencies.length ? (
            <TableWrap label="Owed to us by age">
              <table className="w-full min-w-[40rem] text-callout">
                <thead>
                  <tr>
                    <th className={th}>Currency</th>
                    {AGE_BANDS.map((b) => (
                      <th key={b} className={cn(th, "text-right")}>
                        {AGE_BAND_LABEL[b]}
                      </th>
                    ))}
                    <th className={cn(th, "text-right")}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {currencies.map((c) => {
                    const mine = open.filter((i) => i.currency === c);
                    const sum = (xs: typeof mine) => xs.reduce((t, i) => t + i.outstandingMinor, 0n);
                    return (
                      <tr key={c}>
                        <th scope="row" className={cn(td, "text-left font-semibold")}>
                          {c}
                        </th>
                        {AGE_BANDS.map((b) => (
                          <td key={b} className={cn(td, "text-right tabular-nums")}>
                            {money(sum(mine.filter((i) => i.band === b)), c)}
                          </td>
                        ))}
                        <td className={cn(td, "text-right font-semibold tabular-nums")}>{money(sum(mine), c)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <p className="text-ink-muted">Every invoice is paid.</p>
          )}
        </Card>
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-headline font-bold">{show === "all" ? "Open invoices" : "Overdue invoices"}</h2>
            <nav aria-label="Which invoices" className="flex gap-2 text-callout">
              {(["overdue", "all"] as const).map((k) => (
                <Link key={k} href={k === "all" ? "/admin/finance?show=all" : "/admin/finance"} aria-current={k === show ? "page" : undefined} className={cn("rounded-md border border-line px-3 py-2 font-semibold hover:bg-surface", k === show && "border-brand bg-surface")}>
                  {k === "all" ? "All open" : "Overdue"}
                </Link>
              ))}
            </nav>
          </div>
          {rows.length ? (
            <TableWrap label={show === "all" ? "Open invoices" : "Overdue invoices"}>
              <table className="w-full min-w-[52rem] text-callout">
                <thead>
                  <tr>
                    <th className={th}>Invoice</th>
                    <th className={th}>Customer</th>
                    <th className={th}>Due</th>
                    <th className={cn(th, "text-right")}>Still to pay</th>
                    <th className={th}>Reminders</th>
                    <th className={th}>
                      <span className="sr-only">Chase</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((i) => (
                    <tr key={i.id}>
                      <td className={td}>
                        <a href={`/admin/orders/${i.orderId}/invoice`} className="font-semibold text-link underline underline-offset-4">
                          {i.number}
                        </a>
                        <span className="block text-ink-muted">Order {i.orderNumber}</span>
                      </td>
                      <td className={td}>
                        {i.organisationId ? (
                          <Link href={`/admin/customers/${i.organisationId}`} className="text-link underline underline-offset-4">
                            {i.customer}
                          </Link>
                        ) : (
                          i.customer
                        )}
                        <span className="block text-ink-muted">{i.email}</span>
                      </td>
                      <td className={td}>
                        {date(i.dueAt)}
                        <span className="mt-1 block">
                          <Badge tone={BAND_TONE[i.band]}>{i.daysOverdue > 0 ? `${i.daysOverdue} ${i.daysOverdue === 1 ? "day" : "days"} late` : "Not yet due"}</Badge>
                        </span>
                      </td>
                      <td className={cn(td, "text-right font-semibold tabular-nums")}>{money(i.outstandingMinor, i.currency)}</td>
                      <td className={td}>{i.remindersSent ? `${i.remindersSent}, last ${date(i.lastReminderAt!)}` : "None yet"}</td>
                      <td className={td}>
                        <ActionForm action={sendReminderAction} hidden={{ invoiceId: i.id }} label={`Send a reminder for ${i.number}`} confirm={`Email ${i.email} a reminder about ${i.number}?`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <p className="text-ink-muted">{show === "all" ? "Every invoice is paid." : "Nothing is overdue."}</p>
          )}
        </Card>
      </div>
    </>
  );
}
