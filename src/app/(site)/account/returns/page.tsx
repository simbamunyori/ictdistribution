import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, PageHeader } from "@/components/ui/card";
import { formatDate } from "@/lib/zoned";
import { prisma } from "@/server/db";
import { customerReturns, RETURN_REASON_LABEL, RETURN_STATUS_LABEL, RETURN_STATUS_TONE } from "@/server/portal/returns";
import { portalViewer } from "@/server/portal/viewer";

export const metadata: Metadata = { title: "Returns" };

export default async function ReturnsPage() {
  const v = await portalViewer("/account/returns");
  const returns = await customerReturns(prisma, v);
  return (
    <>
      <PageHeader title="Returns" lead="To send something back, open the order and choose Return items. We answer each request and email you how to send it." />
      {returns.length ? (
        <ul className="flex flex-col gap-3">
          {returns.map((r) => (
            <li key={r.id}>
              <Link href={`/account/returns/${encodeURIComponent(r.number)}`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-raised p-4 hover:border-brand">
                <span>
                  <span className="block font-bold text-ink">
                    {r.number} <span className="font-normal text-ink-muted">for order {r.order.number}</span>
                  </span>
                  <span className="text-callout text-ink-muted">
                    {RETURN_REASON_LABEL[r.reason]}, asked for {formatDate(r.createdAt, r.order.market.locale, r.order.market.timeZone)} by {r.requestedByLabel}
                  </span>
                </span>
                <Badge tone={RETURN_STATUS_TONE[r.status]}>{RETURN_STATUS_LABEL[r.status]}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Card>
          <p>No returns. <Link href="/account/orders" className="text-link underline underline-offset-4">See your orders</Link></p>
        </Card>
      )}
    </>
  );
}
