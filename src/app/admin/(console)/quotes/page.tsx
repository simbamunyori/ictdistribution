import type { QuoteStatus, QuoteType } from "@prisma/client";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, PageHeader, TableWrap, td, th } from "@/components/ui/card";
import { inputClass } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/zoned";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { OPEN_STATUSES, QUOTE_STATUS_LABEL, QUOTE_STATUS_TONE, QUOTE_TYPE_LABEL } from "@/server/quotes/common";
import { durationText, listQuotes, quotesWaiting } from "@/server/quotes/staff";
import { staffCan } from "@/server/staff/access";

export const metadata: Metadata = { title: "Quotes" };

const STATUSES = Object.keys(QUOTE_STATUS_LABEL) as QuoteStatus[];
const TYPES = Object.keys(QUOTE_TYPE_LABEL) as QuoteType[];
const SOURCE = { PORTAL: "On the site", EMAIL: "By email", STAFF: "Entered by staff" } as const;

export default async function Quotes({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const session = await requireStaff();
  const role = { staffRole: session.user.staffRole };
  if (!staffCan(role, "viewQuotes")) redirect("/admin");
  const status = STATUSES.includes(q.status as QuoteStatus) ? (q.status as QuoteStatus) : undefined;
  const type = TYPES.includes(q.type as QuoteType) ? (q.type as QuoteType) : undefined;
  const [quotes, waiting] = await Promise.all([listQuotes(prisma, { status, type, q: q.q }), quotesWaiting(prisma)]);
  const now = new Date().getTime();
  return (
    <>
      <PageHeader
        title="Quotes"
        lead="Requests for quote from the site and by email. Quotes inside the rules go out by themselves; the rest wait here to be checked."
        actions={
          <div className="flex flex-wrap gap-3">
            <Link href="/admin/quotes/report" className="font-semibold text-link underline underline-offset-4">
              Win rate
            </Link>
            <Link href="/admin/quotes/rules" className="font-semibold text-link underline underline-offset-4">
              Rules
            </Link>
          </div>
        }
      />
      {waiting.review || waiting.byHand ? (
        <p className="mb-6 flex flex-wrap gap-3">
          {waiting.review ? (
            <Link href="/admin/quotes?status=REVIEW" className="rounded-md border border-line bg-raised px-3 py-2 font-semibold hover:border-brand">
              {waiting.review} ready to check
            </Link>
          ) : null}
          {waiting.byHand ? (
            <Link href="/admin/quotes?status=WAITING_ON_SUPPLIERS" className="rounded-md border border-line bg-raised px-3 py-2 font-semibold hover:border-brand">
              {waiting.byHand} supplier {waiting.byHand === 1 ? "request" : "requests"} to send on WhatsApp
            </Link>
          ) : null}
        </p>
      ) : null}
      <form className="mb-6 grid gap-3 md:grid-cols-[1fr_12rem_12rem_auto] md:items-end" role="search">
        <label className="flex flex-col gap-1.5">
          <span className="text-callout font-semibold">Search</span>
          <input name="q" defaultValue={q.q} placeholder="Quote number, name, email or tender" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-callout font-semibold">Status</span>
          <select name="status" defaultValue={status ?? ""} className={cn(inputClass, "pr-8")}>
            <option value="">Any status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {QUOTE_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-callout font-semibold">Type</span>
          <select name="type" defaultValue={type ?? ""} className={cn(inputClass, "pr-8")}>
            <option value="">Any type</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {QUOTE_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="h-11 rounded-md border border-line bg-raised px-4 font-semibold hover:bg-surface">
          Show
        </button>
      </form>
      <Card>
        {quotes.length ? (
          <TableWrap label="Quotes">
            <table className="w-full min-w-[52rem] text-callout">
              <thead>
                <tr>
                  <th className={th}>Quote</th>
                  <th className={th}>Customer</th>
                  <th className={th}>Asked for</th>
                  <th className={th}>Time taken</th>
                  <th className={cn(th, "text-right")}>Total</th>
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {quotes.map((x) => (
                  <tr key={x.id}>
                    <td className={td}>
                      <Link href={`/admin/quotes/${x.id}`} className="font-semibold text-link underline underline-offset-4">
                        {x.number}
                      </Link>
                      <span className="block text-caption text-ink-muted">
                        {QUOTE_TYPE_LABEL[x.type]}, {x._count.lines} {x._count.lines === 1 ? "line" : "lines"}
                        {x.urgent ? ", urgent" : ""}
                      </span>
                    </td>
                    <td className={td}>
                      {x.organisation?.name ?? x.companyName ?? x.name}
                      <span className="block text-caption text-ink-muted">{x.email}</span>
                    </td>
                    <td className={td}>
                      {formatDateTime(x.createdAt, x.market.locale, x.market.timeZone)}
                      <span className="block text-caption text-ink-muted">{SOURCE[x.source]}</span>
                    </td>
                    <td className={td}>{x.sentAt ? durationText(x.sentAt.getTime() - x.createdAt.getTime()) : OPEN_STATUSES.includes(x.status) ? `${durationText(now - x.createdAt.getTime())} so far` : "Not sent"}</td>
                    <td className={cn(td, "text-right tabular-nums")}>{x.totalMinor === null ? "" : formatMoney({ amountMinor: x.totalMinor, currency: x.currency }, x.market.locale)}</td>
                    <td className={td}>
                      <Badge tone={QUOTE_STATUS_TONE[x.status]}>{QUOTE_STATUS_LABEL[x.status]}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <p className="text-ink-muted">No quotes match.</p>
        )}
      </Card>
    </>
  );
}
