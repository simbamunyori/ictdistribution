import type { Metadata } from "next";
import Link from "next/link";
import { reorderAction } from "@/app/(site)/account/portal-actions";
import { Button } from "@/components/ui/button";
import { Badge, Card, PageHeader } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/zoned";
import { prisma } from "@/server/db";
import { portalCan } from "@/server/portal/scope";
import { portalViewer } from "@/server/portal/viewer";
import { customerOrders, orderStateText } from "@/server/shop/orders";

export const metadata: Metadata = { title: "Your orders" };

const TONE = { AWAITING_PAYMENT: "warning", PAID: "neutral", ON_ACCOUNT: "neutral", FULFILLED: "positive", CANCELLED: "negative" } as const;
const STATES = [
  ["", "All"],
  ["open", "Being prepared"],
  ["pay", "Waiting for payment"],
  ["sent", "Sent or ready"],
  ["cancelled", "Cancelled"],
] as const;

export default async function AccountOrders({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const v = await portalViewer("/account/orders");
  const state = STATES.find(([k]) => k && k === q.state)?.[0] || undefined;
  const mine = Boolean(v.organisationId && q.mine);
  const orders = await customerOrders(prisma, v, { state, mine });
  const people = v.organisationId ? new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(orders.map((o) => o.userId).filter((id) => id !== null))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name])) : null;
  const buy = portalCan(v, "buy");
  const href = (o: { state?: string; mine?: boolean }) => {
    const p = new URLSearchParams();
    if (o.state) p.set("state", o.state);
    if (o.mine) p.set("mine", "1");
    return `/account/orders${p.size ? `?${p}` : ""}`;
  };
  return (
    <>
      <PageHeader title="Your orders" lead={v.organisationId ? "Orders placed for your organisation, by anyone on the team." : "Orders you placed for yourself."} />
      <nav aria-label="Which orders" className="mb-4 flex flex-wrap gap-2">
        {STATES.map(([k, label]) => (
          <Link key={k || "all"} href={href({ state: k, mine })} aria-current={(state ?? "") === k ? "page" : undefined} className={cn("rounded-full px-3 py-1 text-callout font-semibold", (state ?? "") === k ? "bg-surface text-ink" : "text-link")}>
            {label}
          </Link>
        ))}
        {v.organisationId ? (
          <Link href={href({ state, mine: !mine })} className="rounded-full px-3 py-1 text-callout font-semibold text-link">
            {mine ? "Show the whole team's" : "Show only mine"}
          </Link>
        ) : null}
      </nav>
      {orders.length ? (
        <ul className="flex flex-col gap-3">
          {orders.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-raised p-4">
              <Link href={`/orders/${encodeURIComponent(o.number)}`} className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-3">
                <span>
                  <span className="block font-bold text-link underline-offset-4 hover:underline">
                    {o.number}
                    {o.customerReference ? <span className="font-normal text-ink-muted">, {o.customerReference}</span> : null}
                  </span>
                  <span className="text-callout text-ink-muted">
                    {formatDate(o.createdAt, o.market.locale, o.market.timeZone)}
                    {people && o.userId ? `, by ${people.get(o.userId) ?? "a former member"}` : ""}
                    {o.invoice ? `, invoice ${o.invoice.number}` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <Badge tone={TONE[o.status]}>{orderStateText(o)}</Badge>
                  <span className="font-semibold tabular-nums text-ink">{formatMoney({ amountMinor: o.totalMinor, currency: o.currency }, o.market.locale)}</span>
                </span>
              </Link>
              {buy ? (
                <form action={reorderAction}>
                  <input type="hidden" name="orderNumber" value={o.number} />
                  <Button type="submit" size="sm" variant="secondary">
                    Buy again<span className="sr-only">: order {o.number}</span>
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <Card>
          <p>{state || mine ? "No orders like that." : "No orders yet."}</p>
          <Link href="/products" className="mt-2 inline-block text-link underline underline-offset-4">
            Browse the range
          </Link>
        </Card>
      )}
    </>
  );
}
