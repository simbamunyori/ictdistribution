import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, PageHeader } from "@/components/ui/card";
import { inputClass } from "@/components/ui/field";
import { DEFAULT_TIME_ZONE } from "@/config/app";
import { EXPORT_FORMAT_LABEL, EXPORT_FORMATS } from "@/lib/accounting-export";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { exportData } from "@/server/finance/export";
import { statementPeriod } from "@/server/portal/accounts";
import { staffCan } from "@/server/staff/access";

export const metadata: Metadata = { title: "Export to accounting" };

/** Choose a period and a package; the file downloads from /admin/finance/export-file. */
export default async function ExportPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireStaff();
  if (!staffCan({ staffRole: session.user.staffRole }, "manageFinance")) redirect("/admin");
  const sp = await searchParams;
  const period = statementPeriod(sp.from, sp.to, DEFAULT_TIME_ZONE);
  const { docs, payments } = await exportData(prisma, period.from, period.to);
  const invoices = docs.filter((d) => d.kind === "invoice").length;
  const credits = docs.length - invoices;
  const refunds = payments.filter((p) => p.kind === "refund").length;
  const q = `from=${period.fromDay}&to=${period.toDay}`;
  return (
    <>
      <p className="mb-2 text-callout">
        <Link href="/admin/finance" className="text-link underline underline-offset-4">
          Finance
        </Link>
      </p>
      <PageHeader title="Export to accounting" lead="Invoices, credit notes, payments and refunds for a period, as a file to import into Xero, QuickBooks Online or Sage 50. Codes come from the finance settings; business customers go under their account code." />
      <div className="flex max-w-4xl flex-col gap-6">
        <Card>
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
              Show the period
            </Button>
          </form>
          <p className="mt-4">
            From {period.fromDay} to {period.toDay}: {invoices} {invoices === 1 ? "invoice" : "invoices"}, {credits} {credits === 1 ? "credit note" : "credit notes"}, {payments.length - refunds} {payments.length - refunds === 1 ? "payment" : "payments"} and {refunds} {refunds === 1 ? "refund" : "refunds"}.
          </p>
        </Card>
        <Card>
          <h2 className="mb-3 text-headline font-bold">Download</h2>
          <ul className="flex flex-col gap-3">
            {EXPORT_FORMATS.map((f) => (
              <li key={f}>
                <a href={`/admin/finance/export-file?format=${f}&${q}`} className="font-semibold text-link underline underline-offset-4" download>
                  {EXPORT_FORMAT_LABEL[f]}
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-callout text-ink-muted">Each line is exported before tax with its own share of the tax, so the package&apos;s totals match ours. Sage has no import for money paid back, so enter refunds from the payments file.</p>
        </Card>
      </div>
    </>
  );
}
