import { Check, Plus, Truck } from "lucide-react";
import Link from "next/link";
import { toggleCompareAction } from "@/app/(site)/compare-actions";
import { cn } from "@/lib/cn";
import type { Standing } from "@/lib/standing";
import type { ProductCard as Card } from "@/server/catalogue/shop";
import { AddToCart } from "./add-to-cart";
import { CategoryIcon } from "./category-icon";
import { PriceTag } from "./price-tag";

/** How prices read where the shopper is. */
export interface Where {
  locale: string;
  timeZone: string;
  standing: Standing;
}

/** A product's picture, from our own resized copies, or its category's drawing until a photo is added. */
export function ProductImage({ image, size = "thumb", className, categorySlug }: { image: Card["image"]; size?: "thumb" | "large"; className?: string; categorySlug?: string }) {
  if (!image) {
    return (
      <div className={cn("flex items-center justify-center bg-gradient-to-br from-surface to-page text-ink-muted", className)}>
        <CategoryIcon slug={categorySlug} strokeWidth={1.25} className={size === "large" ? "size-28" : "size-1/3 max-h-20 max-w-20 min-h-8 min-w-8"} />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- already resized to WebP on upload and cached for a year
    <img src={size === "thumb" ? `/media/${image.id}/thumb` : `/media/${image.id}`} alt={image.alt} width={image.width ?? undefined} height={image.height ?? undefined} loading="lazy" decoding="async" className={cn("bg-white object-contain", className)} />
  );
}

/** How much a special saves, as a whole percentage. */
export function savingPercent(price: { amount: { amountMinor: bigint }; was: { amountMinor: bigint } | null }): number | null {
  if (!price.was || price.was.amountMinor <= 0n) return null;
  const pct = Number(((price.was.amountMinor - price.amount.amountMinor) * 100n) / price.was.amountMinor);
  return pct >= 1 ? pct : null;
}

export function CompareToggle({ id, comparing, back, compact = false }: { id: string; comparing: boolean; back: string; /** Just the icon, beside an Add to cart button. */ compact?: boolean }) {
  return (
    <form action={toggleCompareAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="back" value={back} />
      <button type="submit" aria-pressed={comparing} aria-label={compact ? "Compare" : undefined} title={compact ? (comparing ? "Comparing" : "Compare") : undefined} className={cn("inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-raised text-callout font-semibold text-ink hover:bg-surface aria-pressed:border-accent aria-pressed:bg-accent-soft", compact ? "w-9 justify-center" : "px-3")}>
        {comparing ? <Check aria-hidden className="size-4" /> : <Plus aria-hidden className="size-4" />}
        {compact ? null : comparing ? "Comparing" : "Compare"}
      </button>
    </form>
  );
}

/** Why there is no price: not on sale now, or sold to businesses we have approved. */
export function NoPrice({ sellToIndividuals, standing }: { sellToIndividuals: boolean; standing: Standing }) {
  if (sellToIndividuals || standing === "trade") return <p className="text-callout text-ink-muted">Not available to order right now</p>;
  if (standing === "unverified")
    return (
      <p className="text-callout text-ink-muted">
        For businesses. Prices show once{" "}
        <Link href="/account/business" className="text-link underline underline-offset-4">
          we have checked your business
        </Link>
      </p>
    );
  return (
    <p className="text-callout text-ink-muted">
      For businesses.{" "}
      <Link href="/sign-up?for=business" className="text-link underline underline-offset-4">
        Register to see prices
      </Link>
    </p>
  );
}

export function ProductCard({ product, comparing, back, where, headingLevel = 3 }: { product: Card; comparing: boolean; back: string; where: Where; headingLevel?: 2 | 3 }) {
  const Heading = `h${headingLevel}` as const;
  const saving = product.price ? savingPercent(product.price) : null;
  const lead = product.price ? leadTimeShort(product.price.leadTimeDays) : null;
  return (
    <article className="group relative flex w-full flex-col overflow-hidden rounded-lg border border-line bg-raised transition-shadow hover:shadow-[0_4px_16px_rgb(0_0_0/0.08)]">
      <Link href={`/products/${product.slug}`} tabIndex={-1} aria-hidden className="relative block border-b border-line bg-white">
        <ProductImage image={product.image} categorySlug={product.categorySlug} className="aspect-square w-full p-4 transition-transform duration-300 group-hover:scale-[1.03]" />
        {saving ? <span className="absolute top-3 left-3 rounded-sm bg-highlight px-2 py-0.5 text-caption font-bold text-on-highlight">Save {saving}%</span> : null}
      </Link>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <p className="text-caption font-semibold tracking-wide text-ink-muted uppercase">{product.brand}</p>
        <Heading className="line-clamp-2 text-body leading-snug font-semibold text-ink">
          <Link href={`/products/${product.slug}`} className="after:absolute after:inset-0 after:content-[''] hover:text-link hover:underline hover:underline-offset-4">
            {product.name}
          </Link>
        </Heading>
        {product.highlights.length ? <p className="line-clamp-2 text-caption text-ink-muted">{product.highlights.join(" · ")}</p> : null}
        <div className="mt-auto flex flex-col gap-3 pt-3">
          {product.price ? (
            <div>
              <PriceTag price={product.price} locale={where.locale} timeZone={where.timeZone} />
              {lead ? (
                <p className="mt-1 flex items-center gap-1.5 text-caption text-ink-muted">
                  <Truck aria-hidden className="size-3.5 shrink-0" />
                  {lead}
                </p>
              ) : null}
            </div>
          ) : (
            <NoPrice sellToIndividuals={product.sellToIndividuals} standing={where.standing} />
          )}
          <div className="relative z-[1] flex items-center gap-2">
            {product.price ? <AddToCart productId={product.id} size="sm" label="Add" name={`${product.brand} ${product.name}`} idPrefix={`card-${product.id}`} wide /> : null}
            <CompareToggle id={product.id} comparing={comparing} back={back} compact={!!product.price} />
          </div>
        </div>
      </div>
    </article>
  );
}

/** "Ready in 3 days" for a card, from the typical lead time. */
function leadTimeShort(days: number | null): string | null {
  if (days === null) return null;
  return days <= 1 ? "Ready next working day" : `Ready in about ${days} working days`;
}
