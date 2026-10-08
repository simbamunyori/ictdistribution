import { toPlainAmount, type Money } from "./money";

/**
 * Structured data for search engines (schema.org as JSON-LD), so product
 * pages can show in results with their brand, part number, picture and,
 * for products sold to individuals, the price.
 */

export interface ProductForSeo {
  name: string;
  brand: string;
  mpn: string;
  description: string;
  url: string;
  images: string[];
  category: string;
  /** The retail price, with tax, when it is sold to individuals. */
  price: Money | null;
  leadTimeDays: number | null;
  warrantyMonths: number | null;
}

export function productJsonLd(p: ProductForSeo): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: `${p.brand} ${p.name}`,
    brand: { "@type": "Brand", name: p.brand },
    mpn: p.mpn,
    sku: p.mpn,
    category: p.category,
    url: p.url,
    ...(p.description ? { description: p.description.slice(0, 5000) } : {}),
    ...(p.images.length ? { image: p.images } : {}),
    ...(p.price
      ? {
          offers: {
            "@type": "Offer",
            url: p.url,
            price: toPlainAmount(p.price),
            priceCurrency: p.price.currency,
            itemCondition: "https://schema.org/NewCondition",
            // Within a couple of days is in stock for a buyer; longer is ordered in for them.
            availability: p.leadTimeDays === null || p.leadTimeDays <= 2 ? "https://schema.org/InStock" : "https://schema.org/BackOrder",
            ...(p.warrantyMonths ? { warranty: { "@type": "WarrantyPromise", durationOfWarranty: { "@type": "QuantitativeValue", value: p.warrantyMonths, unitCode: "MON" } } } : {}),
          },
        }
      : {}),
  };
}

export function breadcrumbJsonLd(items: { name: string; url: string }[]): Record<string, unknown> {
  return { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: it.url })) };
}

/** JSON for a script tag: "<" escaped, so text in the data can't close the tag. */
export function jsonLdText(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/** A meta description: plain text, at most about 160 characters, cut at a word. */
export function metaDescription(text: string, max = 160): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 40))}...`;
}
