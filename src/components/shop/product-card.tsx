import { Check, Package, Plus } from "lucide-react";
import Link from "next/link";
import { toggleCompareAction } from "@/app/(site)/compare-actions";
import type { Standing } from "@/lib/standing";
import type { ProductCard as Card } from "@/server/catalogue/shop";
import { AddToCart } from "./add-to-cart";
import { PriceTag } from "./price-tag";

/** How prices read where the shopper is. */
export interface Where {
  locale: string;
  timeZone: string;
  standing: Standing;
}

/** A product's picture, from our own resized copies, or a plain placeholder. */
export function ProductImage({ image, size = "thumb", className }: { image: Card["image"]; size?: "thumb" | "large"; className?: string }) {
  if (!image)
    return (
      <div className={`flex items-center justify-center bg-surface text-ink-muted ${className ?? ""}`}>
        <Package aria-hidden className="size-10" />
      </div>
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element -- already resized to WebP on upload and cached for a year
    <img src={size === "thumb" ? `/media/${image.id}/thumb` : `/media/${image.id}`} alt={image.alt} width={image.width ?? undefined} height={image.height ?? undefined} loading="lazy" decoding="async" className={`bg-white object-contain ${className ?? ""}`} />
  );
}

export function CompareToggle({ id, comparing, back }: { id: string; comparing: boolean; back: string }) {
  return (
    <form action={toggleCompareAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="back" value={back} />
      <button type="submit" aria-pressed={comparing} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line px-3 text-callout font-semibold text-ink hover:bg-surface aria-pressed:border-brand aria-pressed:bg-brand-soft">
        {comparing ? <Check aria-hidden className="size-4" /> : <Plus aria-hidden className="size-4" />}
        {comparing ? "Comparing" : "Compare"}
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
  return (
    <article className="flex w-full flex-col overflow-hidden rounded-lg border border-line bg-raised">
      <Link href={`/products/${product.slug}`} tabIndex={-1} aria-hidden className="block">
        <ProductImage image={product.image} className="aspect-[4/3] w-full" />
      </Link>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <p className="text-caption font-semibold text-ink-muted uppercase">{product.brand}</p>
        <Heading className="font-bold leading-snug text-ink">
          <Link href={`/products/${product.slug}`} className="hover:text-link hover:underline hover:underline-offset-4">
            {product.name}
          </Link>
        </Heading>
        {product.highlights.length ? <p className="text-callout text-ink-muted">{product.highlights.join(" · ")}</p> : null}
        <div className="mt-auto flex flex-col gap-3 pt-2">
          {product.price ? (
            <PriceTag price={product.price} locale={where.locale} timeZone={where.timeZone} />
          ) : (
            <NoPrice sellToIndividuals={product.sellToIndividuals} standing={where.standing} />
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {product.price ? <AddToCart productId={product.id} size="sm" label="Add" name={`${product.brand} ${product.name}`} idPrefix={`card-${product.id}`} /> : <span />}
            <CompareToggle id={product.id} comparing={comparing} back={back} />
          </div>
        </div>
      </div>
    </article>
  );
}
