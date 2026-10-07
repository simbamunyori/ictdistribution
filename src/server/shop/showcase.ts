import type { PrismaClient } from "@prisma/client";
import { cardsFor, IN_SHOP, type ProductCard } from "@/server/catalogue/shop";
import { bundlePrice, type BundlePrice, type PriceContext, type PriceableProduct } from "./prices";

/**
 * The specials a shopper can use now, ready to show: products on special
 * as cards, category specials as banners, and bundles with what is in
 * them. `featured` keeps only those chosen for the home page.
 */
export async function specialsFor(db: Pick<PrismaClient, "product" | "special" | "category">, ctx: PriceContext, opts: { featured?: boolean } = {}) {
  const chosen = opts.featured ? new Set((await db.special.findMany({ where: { id: { in: ctx.specials.map((s) => s.id) }, featured: true }, select: { id: true } })).map((s) => s.id)) : null;
  const open = ctx.specials.filter((s) => (!chosen || chosen.has(s.id)) && (s.remaining === null || s.remaining > 0));
  const details = new Map((await db.special.findMany({ where: { id: { in: open.map((s) => s.id) } }, select: { id: true, description: true, category: { select: { name: true, slug: true, active: true } } } })).map((d) => [d.id, d]));

  const productIds = [...new Set(open.filter((s) => s.kind === "PRODUCT").map((s) => s.items[0]?.productId).filter(Boolean))] as string[];
  // A card only where the special is what prices it: another, better special may win.
  const products: ProductCard[] = (await cardsFor(db, productIds, ctx)).filter((c) => c.price?.special);

  const categories = open
    .filter((s) => s.kind === "CATEGORY" && details.get(s.id)?.category?.active)
    .map((s) => ({ id: s.id, slug: s.slug, name: s.name, description: details.get(s.id)?.description ?? "", percent: (s.discountBps ?? 0) / 100, endsAt: s.endsAt, category: details.get(s.id)!.category! }));

  const bundleSpecials = open.filter((s) => s.kind === "BUNDLE");
  const ids = [...new Set(bundleSpecials.flatMap((s) => s.items.map((i) => i.productId)))];
  const rows = ids.length
    ? await db.product.findMany({
        where: { AND: [IN_SHOP, { id: { in: ids } }, { sellToIndividuals: true }] },
        select: { id: true, slug: true, name: true, categoryId: true, landedCostMinor: true, leadTimeDays: true, brand: { select: { name: true } }, category: { select: { parentId: true } }, media: { where: { kind: "IMAGE" }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], take: 1, select: { id: true, alt: true, width: true, height: true } } },
      })
    : [];
  const priceables = new Map<string, PriceableProduct>(rows.map((r) => [r.id, { id: r.id, categoryId: r.categoryId, parentCategoryId: r.category.parentId, landedCostMinor: r.landedCostMinor, leadTimeDays: r.leadTimeDays }]));
  const bundles: { id: string; slug: string; name: string; description: string; price: BundlePrice; items: { slug: string; name: string; brand: string; quantity: number; image: { id: string; alt: string; width: number | null; height: number | null } | null }[] }[] = [];
  for (const s of bundleSpecials) {
    const price = bundlePrice(ctx, s, priceables);
    if (!price) continue;
    const items = s.items.map((i) => {
      const r = rows.find((x) => x.id === i.productId)!;
      return { slug: r.slug, name: r.name, brand: r.brand.name, quantity: i.quantity, image: r.media[0] ?? null };
    });
    bundles.push({ id: s.id, slug: s.slug, name: s.name, description: details.get(s.id)?.description ?? "", price, items });
  }
  return { products, categories, bundles, any: products.length + categories.length + bundles.length > 0 };
}
