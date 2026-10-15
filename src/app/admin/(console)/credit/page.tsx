import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CreditDecisionForm } from "@/components/admin/business-forms";
import { Card, PageHeader } from "@/components/ui/card";
import { formatMoney, toPlainAmount } from "@/lib/money";
import { formatDate } from "@/lib/zoned";
import { creditPosition, MAX_TERMS_DAYS, pendingCreditApplications } from "@/server/accounts/credit";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { staffCan } from "@/server/staff/access";

export const metadata: Metadata = { title: "Credit applications" };

export default async function CreditApplications() {
  const session = await requireStaff();
  const actor = { staffRole: session.user.staffRole };
  if (!staffCan(actor, "manageCredit")) redirect("/admin");
  const applications = await pendingCreditApplications(prisma);
  const positions = await Promise.all(applications.map((a) => creditPosition(prisma, a.organisationId)));
  return (
    <>
      <PageHeader title="Credit applications" lead="Businesses asking to buy on account. Approving sets their limit and days to pay; change them later on the customer's page." />
      {applications.length ? (
        <div className="grid gap-6">
          {applications.map((a, i) => {
            const { currency, locale } = a.organisation.market;
            const money = (amountMinor: bigint) => formatMoney({ amountMinor, currency }, locale);
            const p = positions[i];
            return (
              <Card key={a.id}>
                <h2 className="text-headline font-bold">
                  <Link href={`/admin/customers/${a.organisation.id}`} className="text-link underline underline-offset-4">
                    {a.organisation.name}
                  </Link>
                </h2>
                <p className="mt-1 font-semibold">
                  Asks for {money(a.requestedLimitMinor)} on {a.requestedTermsDays} days
                </p>
                <p className="text-caption text-ink-muted">
                  {a.appliedByLabel}, {formatDate(a.createdAt, locale, a.organisation.market.timeZone)}. {p.limit === null ? "No credit now." : `Now ${money(p.limit)} on ${p.termsDays} days, ${money(p.owed)} owed.`}
                </p>
                <p className="mt-3 text-callout whitespace-pre-line">{a.details}</p>
                <div className="mt-5 border-t border-line pt-5">
                  <CreditDecisionForm applicationId={a.id} organisationId={a.organisation.id} currency={currency} maxDays={MAX_TERMS_DAYS} requested={{ limit: toPlainAmount({ amountMinor: a.requestedLimitMinor, currency }), termsDays: String(a.requestedTermsDays) }} />
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <p>No applications are waiting.</p>
        </Card>
      )}
    </>
  );
}
