import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OrderView } from "@/components/shop/order-view";
import { SiteFrame } from "@/components/site/site-frame";
import { Alert } from "@/components/ui/alert";
import { prisma } from "@/server/db";
import { orderByToken, orderForCustomer } from "@/server/shop/orders";
import { shopper } from "@/server/shop/viewer";

export const metadata: Metadata = { title: "Your order", robots: { index: false }, referrer: "no-referrer" };

/** An order, for whoever holds the link from its email, or the signed-in customer it belongs to. */
export default async function OrderPage({ params, searchParams }: { params: Promise<{ number: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ number }, q, s] = await Promise.all([params, searchParams, shopper()]);
  const order = (q.t ? await orderByToken(prisma, number, q.t) : null) ?? (s.user ? await orderForCustomer(prisma, number, { userId: s.user.id, organisationId: s.organisation?.id ?? null }) : null);
  if (!order) notFound();
  return (
    <SiteFrame>
      <div className="mx-auto max-w-4xl px-4 py-10 md:px-6">
        {q.placed ? (
          <div role="status" className="mb-6">
            <Alert tone="positive">Thank you. Your order is placed and we have emailed the details to {order.email}.</Alert>
          </div>
        ) : null}
        <h1 className="text-title font-bold">Order {order.number}</h1>
        <div className="mt-6">
          <OrderView order={order} />
        </div>
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
