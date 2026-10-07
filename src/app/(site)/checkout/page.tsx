import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BusinessPrompt } from "@/components/shop/business-prompt";
import { CheckoutForm } from "@/components/shop/checkout-form";
import { SiteFrame } from "@/components/site/site-frame";
import { Alert } from "@/components/ui/alert";
import { buttonClass } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { prisma } from "@/server/db";
import { cartLines, priceLines } from "@/server/shop/cart";
import { currentCart } from "@/server/shop/cart-cookie";
import { checkoutOptions, totalsFor } from "@/server/shop/orders";
import { shopSettings } from "@/server/shop/settings";
import { shopPrices, shopper } from "@/server/shop/viewer";

export const metadata: Metadata = { title: "Check out", robots: { index: false } };

export default async function CheckoutPage() {
  const [s, prices, cart, settings] = await Promise.all([shopper(), shopPrices(), currentCart(), shopSettings(prisma)]);
  const lines = cart ? await priceLines(prisma, await cartLines(prisma, cart.id), prices) : [];
  if (!lines.length || lines.some((l) => l.problem)) redirect("/cart");
  const guestCheckout = (await prisma.customerType.findUniqueOrThrow({ where: { code: "INDIVIDUAL" } })).guestCheckout;
  const { market, points, bankTransfer, account } = await checkoutOptions(prisma, prices.market.code, s.standing === "trade" ? (s.organisation?.id ?? null) : null);
  const money = (amountMinor: bigint) => formatMoney({ amountMinor, currency: market.currency }, market.locale);
  const delivery = totalsFor(lines, market, "DELIVERY");
  const collection = totalsFor(lines, market, "COLLECTION");
  const canDeliver = market.deliveryEnabled && delivery.delivery !== null;
  const canReach = canDeliver || points.length > 0;
  return (
    <SiteFrame back="/checkout">
      <div className="mx-auto grid max-w-5xl gap-10 px-4 py-10 md:grid-cols-[minmax(0,1fr)_20rem] md:px-6">
        <div className="min-w-0">
          <h1 className="text-title font-bold">Check out</h1>
          {!s.user ? (
            guestCheckout ? (
              <p className="mt-2 text-ink-muted">
                Ordering as a guest.{" "}
                <Link href="/sign-in?next=/checkout" className="font-semibold text-link underline underline-offset-4">
                  Sign in
                </Link>{" "}
                to keep your orders in your account.
              </p>
            ) : null
          ) : (
            <p className="mt-2 text-ink-muted">Signed in as {s.user.email}{s.organisation ? ` for ${s.organisation.name}` : ""}.</p>
          )}
          <div className="mt-8">
            {!s.user && !guestCheckout ? (
              <div className="flex flex-col gap-4 rounded-lg border border-line bg-raised p-6">
                <p>Sign in or create an account to order. It takes a minute and needs no password.</p>
                <Link href="/sign-in?next=/checkout" className={buttonClass("primary", "md", "self-start")}>
                  Sign in or create an account
                </Link>
              </div>
            ) : !canReach ? (
              <Alert>We can&apos;t deliver or offer collection in {market.name} yet. Contact us to order.</Alert>
            ) : !bankTransfer && !account ? (
              <Alert>Payment isn&apos;t set up for {market.name} yet. Contact us to order.</Alert>
            ) : (
              <CheckoutForm
                prefill={{ email: s.user?.email ?? "", name: s.user?.name ?? "", phone: s.user?.phone ?? "" }}
                choices={{
                  delivery: canDeliver ? { fee: delivery.delivery!.amountMinor === 0n ? "free" : money(delivery.delivery!.amountMinor), note: market.deliveryNote } : null,
                  points: points.map((p) => ({ id: p.id, name: p.name, address: p.address, hours: p.hours })),
                  bankTransfer,
                  account: account ? { available: money(account.available), termsDays: account.termsDays ?? 0 } : null,
                  business: s.standing === "trade",
                  totals: { DELIVERY: canDeliver ? money(delivery.total.amountMinor) : null, COLLECTION: money(collection.total.amountMinor) },
                  taxName: market.taxName,
                  payDays: settings.payDays,
                }}
              />
            )}
          </div>
        </div>
        <aside aria-labelledby="summary" className="flex flex-col gap-4 self-start">
          <div className="rounded-lg border border-line bg-raised p-5">
            <h2 id="summary" className="text-headline font-bold">
              Your order
            </h2>
            <ul className="mt-3 flex flex-col gap-3">
              {lines.map((l) => (
                <li key={l.id} className="flex justify-between gap-3 text-callout">
                  <span className="min-w-0">
                    {l.quantity} x {l.name}
                    {l.special ? <span className="block text-caption font-semibold text-link">{l.special.name}</span> : null}
                  </span>
                  <span className="font-semibold tabular-nums">{l.total ? money(l.total.amountMinor) : ""}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 flex justify-between gap-3 border-t border-line pt-3 font-semibold">
              <span>Items</span>
              <span className="tabular-nums">{money(collection.subtotal.amountMinor)}</span>
            </p>
            <p className="mt-1 text-caption text-ink-muted">Including {market.taxName}. Delivery is added if you choose it.</p>
            <Link href="/cart" className="mt-3 inline-block text-callout text-link underline underline-offset-4">
              Change your cart
            </Link>
          </div>
          <BusinessPrompt />
        </aside>
      </div>
    </SiteFrame>
  );
}
