import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CreditApplicationForm } from "@/components/account/business-forms";
import { Badge, Card, PageHeader, TableWrap, td, th } from "@/components/ui/card";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/zoned";
import { creditPosition, MAX_TERMS_DAYS } from "@/server/accounts/credit";
import { actorFor } from "@/server/accounts/organisations";
import { requireCustomer } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { can } from "@/server/org/access";

export const metadata: Metadata = { title: "Credit" };

const APP_LABEL = { PENDING: "With Finance", APPROVED: "Approved", DECLINED: "Declined", WITHDRAWN: "Withdrawn" } as const;
const APP_TONE = { PENDING: "warning", APPROVED: "positive", DECLINED: "negative", WITHDRAWN: "neutral" } as const;

export default async function CreditPage() {
  const session = await requireCustomer("/account/credit");
  const actor = await actorFor(prisma, session);
  if (!actor) redirect("/account");
  const now = new Date();
  const [org, position, applications, open] = await Promise.all([
    prisma.organisation.findUniqueOrThrow({ where: { id: actor.organisationId }, include: { market: true } }),
    creditPosition(prisma, actor.organisationId, now),
    prisma.creditApplication.findMany({ where: { organisationId: actor.organisationId }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.order.findMany({
      where: { organisationId: actor.organisationId, paymentMethod: "ACCOUNT", status: { not: "CANCELLED" }, paidAt: null },
      select: { id: true, number: true, createdAt: true, payBy: true, totalMinor: true, customerReference: true, payments: { select: { amountMinor: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const { locale, timeZone, currency } = org.market;
  const money = (amountMinor: bigint) => formatMoney({ amountMinor, currency }, locale);
  const finance = can(actor, "finance");
  const pending = applications.some((a) => a.status === "PENDING");

  return (
    <>
      <PageHeader title="Credit" lead="Buy on account and pay on terms. Finance sets the limit and the days to pay." />
      <div className="grid gap-6">
        {org.verification !== "APPROVED" ? (
          <Card>
            <p>
              We check your business before offering credit.{" "}
              <Link href="/account/business" className="font-semibold text-link underline underline-offset-4">
                Send your company details
              </Link>
            </p>
          </Card>
        ) : (
          <Card>
            <h2 className="text-headline font-bold">Your account</h2>
            {position.limit === null ? (
              <p className="mt-2">You have no credit account yet. Apply below.</p>
            ) : (
              <>
                {position.onHold ? <p className="mt-2 font-semibold text-negative">Your account is on hold. Contact us, or pay by bank transfer for now.</p> : null}
                <dl className="mt-4 grid gap-4 sm:grid-cols-4">
                  {[
                    ["Limit", money(position.limit)],
                    ["Terms", `${position.termsDays} days`],
                    ["Owed", money(position.owed)],
                    ["Available", money(position.available)],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-caption font-semibold text-ink-muted uppercase">{k}</dt>
                      <dd className="text-headline font-bold tabular-nums">{v}</dd>
                    </div>
                  ))}
                </dl>
                {position.overdue > 0n ? <p className="mt-3 font-semibold text-negative">{money(position.overdue)} is past its pay-by date.</p> : null}
              </>
            )}
          </Card>
        )}

        {open.length ? (
          <Card>
            <h2 className="text-headline font-bold">To pay</h2>
            <TableWrap label="Orders on account still to pay">
              <table className="mt-3 w-full text-callout">
                <thead>
                  <tr>
                    <th scope="col" className={th}>Order</th>
                    <th scope="col" className={th}>Your reference</th>
                    <th scope="col" className={th}>Pay by</th>
                    <th scope="col" className={`${th} text-right`}>Still to pay</th>
                  </tr>
                </thead>
                <tbody>
                  {open.map((o) => {
                    const left = o.totalMinor - o.payments.reduce((n, p) => n + p.amountMinor, 0n);
                    const late = o.payBy !== null && o.payBy < now;
                    return (
                      <tr key={o.id}>
                        <td className={td}>
                          <Link href={`/orders/${encodeURIComponent(o.number)}`} className="font-semibold text-link underline underline-offset-4">
                            {o.number}
                          </Link>
                        </td>
                        <td className={td}>{o.customerReference || "None"}</td>
                        <td className={td}>
                          {o.payBy ? formatDate(o.payBy, locale, timeZone) : ""} {late ? <Badge tone="negative">Overdue</Badge> : null}
                        </td>
                        <td className={`${td} text-right font-semibold tabular-nums`}>{money(left)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
            <p className="mt-3 text-callout text-ink-muted">Pay by bank transfer with the order number as the reference. The bank details are on each order.</p>
          </Card>
        ) : null}

        {org.verification === "APPROVED" && finance && !pending ? (
          <Card>
            <h2 className="text-headline font-bold">{position.limit === null ? "Apply for credit" : "Ask for a change"}</h2>
            <p className="mt-1 mb-4 text-callout text-ink-muted">Our Finance team reviews every application and may ask for more.</p>
            <CreditApplicationForm currency={currency} maxDays={MAX_TERMS_DAYS} />
          </Card>
        ) : org.verification === "APPROVED" && !finance && position.limit === null ? (
          <Card>
            <p>The organisation&apos;s owner or finance contact applies for credit.</p>
          </Card>
        ) : null}

        {applications.length ? (
          <Card>
            <h2 className="text-headline font-bold">Applications</h2>
            <ul className="mt-3 divide-y divide-line">
              {applications.map((a) => (
                <li key={a.id} className="py-3">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">
                      {money(a.requestedLimitMinor)} on {a.requestedTermsDays} days
                    </span>
                    <Badge tone={APP_TONE[a.status]}>{APP_LABEL[a.status]}</Badge>
                  </p>
                  <p className="text-caption text-ink-muted">
                    {a.appliedByLabel}, {formatDate(a.createdAt, locale, timeZone)}
                  </p>
                  {a.decisionNote ? <p className="mt-1 text-callout">{a.decisionNote}</p> : null}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </>
  );
}
