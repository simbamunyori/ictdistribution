import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { reorderAction, saveOrderAsListAction } from "@/app/(site)/account/portal-actions";
import { NameListForm } from "@/components/account/portal-forms";
import { OrderView } from "@/components/shop/order-view";
import { Button, ButtonLink } from "@/components/ui/button";
import { SiteFrame } from "@/components/site/site-frame";
import { Alert } from "@/components/ui/alert";
import { prisma } from "@/server/db";
import { orderLogistics } from "@/server/logistics/tracking";
import { returnableLines } from "@/server/portal/returns";
import { inScope, portalCan } from "@/server/portal/scope";
import { shopper, viewableOrder } from "@/server/shop/viewer";

export const metadata: Metadata = { title: "Your order", robots: { index: false }, referrer: "no-referrer" };

/** An order, for whoever holds the link from its email, or the signed-in customer it belongs to. */
export default async function OrderPage({ params, searchParams }: { params: Promise<{ number: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ number }, q, s] = await Promise.all([params, searchParams, shopper()]);
  const seen = await viewableOrder(number, q.t ?? "");
  if (!seen) notFound();
  const { order } = seen;
  const [logistics, invoice] = await Promise.all([orderLogistics(prisma, order.id), prisma.invoice.findUnique({ where: { orderId: order.id }, select: { number: true } })]);
  // Buying again, lists and returns are for the signed-in customer the order belongs to.
  const v = s.user ? { userId: s.user.id, organisationId: s.organisation?.id ?? null, role: s.organisation?.role ?? null } : null;
  const mine = v && inScope(v, order) && portalCan(v, "buy") ? v : null;
  const [returnable, placedBy] = await Promise.all([mine ? returnableLines(prisma, order.id) : null, order.organisationId && order.userId && v && inScope(v, order) ? prisma.user.findUnique({ where: { id: order.userId }, select: { name: true } }) : null]);
  const base = `/orders/${encodeURIComponent(order.number)}`;
  const t = seen.byLink && q.t ? `?t=${encodeURIComponent(q.t)}` : "";
  const sent = logistics.deliveries.some((d) => d.status !== "PREPARED") || order.status === "FULFILLED";
  return (
    <SiteFrame>
      <div className="mx-auto max-w-4xl px-4 py-10 md:px-6">
        {q.placed ? (
          <div role="status" className="mb-6">
            <Alert tone="positive">Thank you. Your order is placed and we have emailed the details to {order.email}.</Alert>
          </div>
        ) : null}
        {q.problem ? (
          <div className="mb-6">
            <Alert>{q.problem}</Alert>
          </div>
        ) : null}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-title font-bold">Order {order.number}</h1>
            {placedBy ? <p className="mt-1 text-ink-muted">Placed by {placedBy.name}</p> : null}
          </div>
          {mine ? (
            <div className="flex flex-wrap gap-2">
              <form action={reorderAction}>
                <input type="hidden" name="orderNumber" value={order.number} />
                <Button type="submit">Buy again</Button>
              </form>
              {returnable?.open ? (
                <ButtonLink href={`/account/returns/new?order=${encodeURIComponent(order.number)}`} variant="secondary">
                  Return items
                </ButtonLink>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="mt-6">
          <OrderView
            order={order}
            proFormaHref={`${base}/pro-forma${t}`}
            invoice={invoice ? { number: invoice.number, href: `${base}/invoice${t}` } : undefined}
            logistics={{ ...logistics, deliveries: logistics.deliveries.filter((d) => d.status !== "PREPARED") }}
            links={{ note: (n) => `${base}/deliveries/${encodeURIComponent(n)}/note${t}`, pod: (n) => `${base}/deliveries/${encodeURIComponent(n)}/pod${t}`, commercialInvoice: sent && order.fulfilment === "DELIVERY" ? `${base}/commercial-invoice${t}` : undefined }}
          />
        </div>
        {mine ? (
          <section aria-labelledby="save-list" className="mt-8 rounded-lg border border-line bg-raised p-5">
            <h2 id="save-list" className="text-headline font-bold">
              Save as a list
            </h2>
            <p className="mt-1 mb-3 text-callout text-ink-muted">Keep these products and quantities to buy again later, from Saved lists in your account.</p>
            <NameListForm action={saveOrderAsListAction} hidden={{ orderNumber: order.number }} label="Save as a list" defaultName={order.customerReference || `Order ${order.number}`} />
          </section>
        ) : null}
        <p className="mt-8 text-callout text-ink-muted">
          Questions about this order? Contact us and quote {order.number}.
          {s.user ? (
            <>
              {" "}
              <Link href="/account/orders" className="text-link underline underline-offset-4">
                See all your orders
              </Link>
              .
            </>
          ) : null}
        </p>
      </div>
    </SiteFrame>
  );
}
