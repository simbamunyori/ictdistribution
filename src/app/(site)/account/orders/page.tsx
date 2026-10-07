import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, PageHeader } from "@/components/ui/card";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/zoned";
import { requireCustomer } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { customerOrders, orderStateText } from "@/server/shop/orders";

export const metadata: Metadata = { title: "Your orders" };

const TONE = { AWAITING_PAYMENT: "warning", PAID: "neutral", FULFILLED: "positive", CANCELLED: "negative" } as const;

export default async function AccountOrders() {
  const session = await requireCustomer("/account/orders");
  const orders = await customerOrders(prisma, { userId: session.userId, organisationId: session.activeOrganisationId });
  return (
    <>
      <PageHeader title="Your orders" lead={session.activeOrganisationId ? "Orders placed for your organisation, by anyone on the team." : "Orders you placed for yourself."} />
      {orders.length ? (
        <ul className="flex flex-col gap-3">
          {orders.map((o) => (
            <li key={o.id}>
              <Link href={`/orders/${encodeURIComponent(o.number)}`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-raised p-4 hover:border-brand">
                <span>
                  <span className="block font-bold text-ink">{o.number}</span>
                  <span className="text-callout text-ink-muted">{formatDate(o.createdAt, o.market.locale, o.market.timeZone)}</span>
                </span>
                <span className="flex items-center gap-3">
                  <Badge tone={TONE[o.status]}>{orderStateText(o)}</Badge>
                  <span className="font-semibold tabular-nums">{formatMoney({ amountMinor: o.totalMinor, currency: o.currency }, o.market.locale)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Card>
          <p>No orders yet.</p>
          <Link href="/products" className="mt-2 inline-block text-link underline underline-offset-4">
            Browse the range
          </Link>
        </Card>
      )}
    </>
  );
}
