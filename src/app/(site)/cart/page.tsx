import type { Metadata } from "next";
import Link from "next/link";
import { updateCartLineAction } from "@/app/(site)/shop-actions";
import { BusinessPrompt } from "@/components/shop/business-prompt";
import { ProductImage } from "@/components/shop/product-card";
import { SpecialLine } from "@/components/shop/price-tag";
import { SiteFrame } from "@/components/site/site-frame";
import { Alert } from "@/components/ui/alert";
import { buttonClass } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/money";
import { deliveryFee } from "@/lib/shop-pricing";
import { prisma } from "@/server/db";
import { cartLines, priceLines, subtotal, TRADE_MAX_LINE } from "@/server/shop/cart";
import { currentCart } from "@/server/shop/cart-cookie";
import { shopSettings } from "@/server/shop/settings";
import { shopPrices, shopWhere } from "@/server/shop/viewer";

export const metadata: Metadata = { title: "Your cart", robots: { index: false } };

export default async function CartPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const [prices, cart, settings] = await Promise.all([shopPrices(), currentCart(), shopSettings(prisma)]);
  const lines = cart ? await priceLines(prisma, await cartLines(prisma, cart.id), prices) : [];
  const market = await prisma.market.findUniqueOrThrow({ where: { code: prices.market.code } });
  const points = await prisma.collectionPoint.count({ where: { marketCode: market.code, active: true } });
  const where = await shopWhere();
  const trade = where.standing === "trade";
  const money = (amountMinor: bigint) => formatMoney({ amountMinor, currency: market.currency }, market.locale);
  const sub = subtotal(lines, market.currency);
  const fee = deliveryFee(sub.amountMinor, market);
  const problems = lines.filter((l) => l.problem);
  return (
    <SiteFrame back="/cart">
      <div className="mx-auto max-w-4xl px-4 py-10 md:px-6">
        <h1 className="text-title font-bold">Your cart</h1>
        <div className="mt-4 flex flex-col gap-3">
          {q.added ? (
            <div role="status">
              <Alert tone="positive">Added to your cart.</Alert>
            </div>
          ) : null}
          {q.problem ? <Alert>{q.problem}</Alert> : null}
          {problems.length ? <Alert>Some items can&apos;t be ordered now. Remove them or change the quantity to check out.</Alert> : null}
        </div>
        {lines.length ? (
          <>
            <ul className="mt-6 divide-y divide-line rounded-lg border border-line bg-raised">
              {lines.map((l) => (
                <li key={l.id} className="grid grid-cols-[4rem_minmax(0,1fr)] gap-4 p-4 sm:grid-cols-[5rem_minmax(0,1fr)_auto]">
                  <ProductImage image={l.image ? { ...l.image, width: null, height: null } : null} className="aspect-square w-full rounded-md border border-line" />
                  <div className="min-w-0">
                    {l.brand ? <p className="text-caption font-semibold text-ink-muted uppercase">{l.brand}</p> : null}
                    <p className="font-bold text-ink">
                      {l.href ? (
                        <Link href={l.href} className="hover:text-link hover:underline">
                          {l.name}
                        </Link>
                      ) : (
                        l.name
                      )}
                    </p>
                    {l.contents.length ? <p className="text-callout text-ink-muted">{l.contents.map((c) => `${c.quantity} x ${c.name}`).join(", ")}</p> : null}
                    {l.usualUnit ? (
                      <p className="mt-1 text-callout text-ink-body">
                        {l.specialUnit ? (
                          <>
                            {money(l.specialUnit.amountMinor)} each{l.specialUnits < l.quantity ? ` for ${l.specialUnits}, then ${money((l.volumeUnit ?? l.usualUnit).amountMinor)}` : ""}{" "}
                            <span className="text-ink-muted line-through">
                              <span className="sr-only">usually </span>
                              {money(l.usualUnit.amountMinor)}
                            </span>
                          </>
                        ) : l.volumeUnit && l.volumeDiscountBps ? (
                          <>
                            {money(l.volumeUnit.amountMinor)} each for {l.quantity}{" "}
                            <span className="text-ink-muted line-through">
                              <span className="sr-only">usually </span>
                              {money(l.usualUnit.amountMinor)}
                            </span>
                          </>
                        ) : (
                          <>{money(l.usualUnit.amountMinor)} each</>
                        )}
                      </p>
                    ) : null}
                    {l.volumeDiscountBps ? (
                      <p className="text-caption text-ink-muted">
                        Buying {l.quantity} takes {l.volumeDiscountBps / 100}% off{l.specialUnits ? " the units not on special" : ""}.
                      </p>
                    ) : null}
                    {l.special ? (
                      <div className="mt-1">
                        <SpecialLine special={{ ...l.special, remaining: null }} locale={where.locale} timeZone={where.timeZone} />
                      </div>
                    ) : null}
                    {l.problem ? <p className="mt-1 text-callout font-semibold text-negative">{l.problem}</p> : null}
                    <form action={updateCartLineAction} className="mt-3 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="lineId" value={l.id} />
                      <input type="hidden" name="back" value="/cart" />
                      <label className="flex flex-col gap-1 text-caption font-semibold text-ink-muted">
                        Quantity
                        {trade ? (
                          <input name="quantity" type="number" inputMode="numeric" min={1} max={TRADE_MAX_LINE} step={1} required defaultValue={String(l.quantity)} className={cn(inputClass, "w-28")} />
                        ) : (
                          <select name="quantity" defaultValue={String(l.quantity)} className={cn(inputClass, "w-20")}>
                            {Array.from({ length: Math.max(settings.maxLineQuantity, l.quantity) }, (_, i) => (
                              <option key={i + 1} value={i + 1}>
                                {i + 1}
                              </option>
                            ))}
                          </select>
                        )}
                      </label>
                      <button type="submit" className={buttonClass("secondary", "sm")}>
                        Update
                      </button>
                      <button type="submit" name="remove" value="1" className="px-2 py-1.5 text-callout text-link underline underline-offset-4">
                        Remove
                      </button>
                    </form>
                  </div>
                  <p className="col-start-2 font-bold tabular-nums sm:col-start-3 sm:text-right">{l.total ? money(l.total.amountMinor) : ""}</p>
                </li>
              ))}
            </ul>
            <div className="mt-6 grid gap-6 md:grid-cols-[minmax(0,1fr)_20rem]">
              <BusinessPrompt className="self-start" />
              <div className="rounded-lg border border-line bg-surface p-5">
                <dl className="flex flex-col gap-2">
                  <div className="flex justify-between gap-4">
                    <dt>Items</dt>
                    <dd className="font-semibold tabular-nums">{money(sub.amountMinor)}</dd>
                  </div>
                  <div className="flex justify-between gap-4 text-callout text-ink-muted">
                    <dt>Delivery</dt>
                    <dd className="text-right">{fee === null ? (points ? "Collection only" : "Not available yet") : fee === 0n ? "Free" : money(fee)}</dd>
                  </div>
                </dl>
                {fee !== null && fee > 0n && market.freeDeliveryMinor !== null ? <p className="mt-2 text-caption text-ink-muted">Free delivery from {money(market.freeDeliveryMinor)}.</p> : null}
                <p className="mt-2 text-caption text-ink-muted">Prices include {market.taxName}. Choose delivery or collection at checkout.</p>
                {problems.length || sub.amountMinor === 0n ? (
                  <p className="mt-4 text-callout text-ink-muted">Fix the items marked above to check out.</p>
                ) : (
                  <Link href="/checkout" className={buttonClass("primary", "lg", "mt-4 w-full")}>
                    Check out
                  </Link>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="mt-6 rounded-lg border border-line bg-raised p-6">
            <p className="font-semibold">Your cart is empty.</p>
            <p className="mt-1 text-ink-muted">
              <Link href="/products" className="text-link underline underline-offset-4">
                Browse the range
              </Link>{" "}
              or{" "}
              <Link href="/specials" className="text-link underline underline-offset-4">
                see the specials
              </Link>
              .
            </p>
          </div>
        )}
      </div>
    </SiteFrame>
  );
}
