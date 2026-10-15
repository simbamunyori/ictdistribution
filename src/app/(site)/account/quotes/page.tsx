import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { Badge, Card, PageHeader } from "@/components/ui/card";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/zoned";
import { requireCustomer } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { customerStatusText, OPEN_STATUSES, QUOTE_STATUS_TONE, QUOTE_TYPE_LABEL } from "@/server/quotes/common";
import { customerQuotes } from "@/server/quotes/customer";

export const metadata: Metadata = { title: "Your quotes" };

export default async function AccountQuotes() {
  const session = await requireCustomer("/account/quotes");
  const quotes = await customerQuotes(prisma, { userId: session.userId, organisationId: session.activeOrganisationId });
  return (
    <>
      <PageHeader title="Your quotes" lead={session.activeOrganisationId ? "Quotes asked for by anyone on your team." : "Quotes you asked for."} />
      <div className="mb-6">
        <ButtonLink href="/account/quotes/new">Ask for a quote</ButtonLink>
      </div>
      {quotes.length ? (
        <ul className="flex flex-col gap-3">
          {quotes.map((q) => (
            <li key={q.id}>
              <Link href={`/quotes/${encodeURIComponent(q.number)}`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-raised p-4 hover:border-brand">
                <span>
                  <span className="block font-bold text-ink">
                    {q.number}
                    {q.customerReference ? <span className="font-normal text-ink-muted">, {q.customerReference}</span> : null}
                  </span>
                  <span className="text-callout text-ink-muted">
                    {QUOTE_TYPE_LABEL[q.type]}, asked for {formatDate(q.createdAt, q.market.locale, q.market.timeZone)}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <Badge tone={OPEN_STATUSES.includes(q.status) ? "neutral" : QUOTE_STATUS_TONE[q.status]}>{customerStatusText(q.status)}</Badge>
                  {q.totalMinor !== null && !OPEN_STATUSES.includes(q.status) ? <span className="font-semibold tabular-nums">{formatMoney({ amountMinor: q.totalMinor, currency: q.currency }, q.market.locale)}</span> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Card>
          <p>No quotes yet. Send us a list, a spreadsheet or a tender and we price it for you.</p>
        </Card>
      )}
    </>
  );
}
