import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader, TableWrap, td, th } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { quoteReport, type WinRow } from "@/server/quotes/report";
import { durationText } from "@/server/quotes/staff";
import { staffCan } from "@/server/staff/access";

export const metadata: Metadata = { title: "Quote win rate" };

const PERIODS = [30, 90, 365] as const;

function Rows({ label, rows }: { label: string; rows: WinRow[] }) {
  return (
    <TableWrap label={label}>
      <table className="w-full min-w-[44rem] text-callout">
        <thead>
          <tr>
            <th className={th}>{label}</th>
            <th className={cn(th, "text-right")}>Requests</th>
            <th className={cn(th, "text-right")}>Sent</th>
            <th className={cn(th, "text-right")}>By itself</th>
            <th className={cn(th, "text-right")}>Won</th>
            <th className={cn(th, "text-right")}>Lost</th>
            <th className={cn(th, "text-right")}>Win rate</th>
            <th className={cn(th, "text-right")}>Average time</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row" className={cn(td, "text-left font-semibold")}>
                {r.label}
              </th>
              <td className={cn(td, "text-right tabular-nums")}>{r.requests}</td>
              <td className={cn(td, "text-right tabular-nums")}>{r.sent}</td>
              <td className={cn(td, "text-right tabular-nums")}>{r.automatic}</td>
              <td className={cn(td, "text-right tabular-nums")}>{r.accepted}</td>
              <td className={cn(td, "text-right tabular-nums")}>{r.lost}</td>
              <td className={cn(td, "text-right tabular-nums")}>{r.winRate === null ? "None yet" : `${Math.round(r.winRate * 100)}%`}</td>
              <td className={cn(td, "text-right tabular-nums")}>{r.averageMs === null ? "" : durationText(r.averageMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export default async function QuoteReport({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [session, sp] = await Promise.all([requireStaff(), searchParams]);
  if (!staffCan({ staffRole: session.user.staffRole }, "viewQuotes")) redirect("/admin");
  const days = PERIODS.find((p) => String(p) === sp.days) ?? 90;
  const report = await quoteReport(prisma, new Date(new Date().getTime() - days * 86_400_000));
  return (
    <>
      <p className="mb-2 text-callout">
        <Link href="/admin/quotes" className="text-link underline underline-offset-4">
          Quotes
        </Link>
      </p>
      <PageHeader title="Quote win rate" lead="Won is accepted. Lost is declined or expired without an answer. A quote counts once in every category it has a line in." />
      <nav aria-label="Period" className="mb-6 flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <Link key={p} href={`/admin/quotes/report?days=${p}`} aria-current={p === days ? "page" : undefined} className={cn("rounded-md border border-line px-3 py-2 font-semibold hover:bg-surface", p === days && "border-brand bg-surface")}>
            Last {p} days
          </Link>
        ))}
      </nav>
      <div className="flex flex-col gap-6">
        <Card>
          <h2 className="mb-3 text-headline font-bold">By type</h2>
          <Rows label="Type" rows={[...report.byType, report.total]} />
        </Card>
        <Card>
          <h2 className="mb-3 text-headline font-bold">By category</h2>
          {report.byCategory.length ? <Rows label="Category" rows={report.byCategory} /> : <p className="text-ink-muted">No quotes in this period.</p>}
        </Card>
      </div>
    </>
  );
}
