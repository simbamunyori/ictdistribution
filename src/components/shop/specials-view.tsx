import { Clock, Percent, Plus } from "lucide-react";
import Link from "next/link";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/zoned";
import type { specialsFor } from "@/server/shop/showcase";
import { AddToCart } from "./add-to-cart";
import { Countdown } from "./countdown";
import { ProductCard, ProductImage, type Where } from "./product-card";

type Specials = Awaited<ReturnType<typeof specialsFor>>;

export function CategorySpecials({ items, where }: { items: Specials["categories"]; where: Where }) {
  if (!items.length) return null;
  return (
    <ul className="grid gap-4 md:grid-cols-2">
      {items.map((c) => (
        <li key={c.id} id={c.slug} className="flex items-start gap-4 rounded-lg border border-line bg-raised p-5">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-highlight text-on-highlight">
            <Percent aria-hidden className="size-6" />
          </span>
          <div className="min-w-0">
            <h3 className="font-bold text-ink">{c.name}</h3>
            <p className="mt-1 text-callout text-ink-body">{c.description || `${c.percent}% off ${c.category.name.toLowerCase()}.`}</p>
            <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-callout">
              <Link href={`/categories/${c.category.slug}`} className="font-semibold text-link underline underline-offset-4">
                Shop {c.category.name.toLowerCase()}
              </Link>
              <span className="inline-flex items-center gap-1 text-caption text-ink-muted">
                <Clock aria-hidden className="size-3.5" />
                <Countdown endsAt={c.endsAt.toISOString()} fallback={`Ends ${formatDateTime(c.endsAt, where.locale, where.timeZone)}`} />
              </span>
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function BundleSpecials({ items, where }: { items: Specials["bundles"]; where: Where }) {
  if (!items.length) return null;
  return (
    <ul className="grid gap-4 lg:grid-cols-2">
      {items.map((b) => (
        <li key={b.id} id={b.slug} className="flex flex-col gap-4 rounded-lg border border-line bg-raised p-5">
          <div>
            <h3 className="font-bold text-ink">{b.name}</h3>
            {b.description ? <p className="mt-1 text-callout text-ink-body">{b.description}</p> : null}
          </div>
          <ul className="flex flex-wrap items-center gap-2" aria-label="In the bundle">
            {b.items.map((i, n) => (
              <li key={i.slug} className="flex items-center gap-2">
                {n ? <Plus aria-hidden className="size-4 text-ink-muted" /> : null}
                <Link href={`/products/${i.slug}`} className="flex max-w-[14rem] items-center gap-2 rounded-md border border-line p-2 hover:bg-surface">
                  <ProductImage image={i.image} className="size-12 shrink-0 rounded-sm" />
                  <span className="text-callout">
                    {i.quantity > 1 ? `${i.quantity} x ` : ""}
                    <span className="font-semibold text-ink">{i.brand}</span> {i.name}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-auto flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-headline font-bold tabular-nums">{formatMoney(b.price.amount, where.locale)}</span>
                <span className="text-callout text-ink-muted line-through tabular-nums">
                  <span className="sr-only">Bought separately </span>
                  {formatMoney(b.price.was, where.locale)}
                </span>
              </p>
              <p className="mt-1 inline-flex items-center gap-1 text-caption text-ink-muted">
                <Clock aria-hidden className="size-3.5" />
                <Countdown endsAt={b.price.special.endsAt.toISOString()} fallback={`Ends ${formatDateTime(b.price.special.endsAt, where.locale, where.timeZone)}`} />
                {b.price.special.remaining !== null && b.price.special.remaining <= 20 ? <span className="ml-2">{b.price.special.remaining} left</span> : null}
              </p>
            </div>
            <AddToCart bundleId={b.id} label="Add the bundle" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ProductSpecials({ items, compare, back, where }: { items: Specials["products"]; compare: string[]; back: string; where: Where }) {
  if (!items.length) return null;
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((p) => (
        <li key={p.id} className="flex">
          <ProductCard product={p} comparing={compare.includes(p.id)} back={back} where={where} />
        </li>
      ))}
    </ul>
  );
}
