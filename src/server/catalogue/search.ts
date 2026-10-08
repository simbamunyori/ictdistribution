import type { Prisma, PrismaClient } from "@prisma/client";
import { alternatives } from "@/lib/assistant";
import { searchTerms } from "@/lib/catalogue";
import type { PriceContext } from "@/server/shop/prices";
import { cardsFor, IN_SHOP, termWhere, type ProductCard } from "./shop";

/**
 * Finding products from what someone types, for the assistant and for
 * close matches when a search finds nothing. Each word also matches the
 * other words people use for the same thing (laptop and notebook). When
 * every word together finds nothing, products matching most of the words
 * come next, then products spelled like the search (for typing slips),
 * using the trigram index on the search text.
 */

export type MatchKind = "all" | "most" | "close" | "none";

export interface FindInput {
  query: string;
  /** Words already read from `query`; otherwise read from it. */
  terms?: string[];
  /** A category or subcategory slug. */
  category?: string | null;
  /** Products priced at most this, in minor units of the visitor's currency. Products without a shown price are kept. */
  maxPriceMinor?: bigint | null;
  limit?: number;
}

export async function findProducts(db: Pick<PrismaClient, "product" | "category" | "$queryRaw">, input: FindInput, ctx?: PriceContext): Promise<{ kind: MatchKind; items: ProductCard[] }> {
  const terms = (input.terms ?? searchTerms(input.query)).slice(0, 8);
  const limit = Math.min(input.limit ?? 8, 24);
  let scope: Prisma.ProductWhereInput = IN_SHOP;
  if (input.category) {
    const c = await db.category.findUnique({ where: { slug: input.category }, select: { id: true, children: { select: { id: true } } } });
    if (c) scope = { AND: [IN_SHOP, { categoryId: { in: [c.id, ...c.children.map((x) => x.id)] } }] };
  }
  const pick = async (ids: string[]) => {
    const cards = await cardsFor(db, ids, ctx);
    const max = input.maxPriceMinor ?? null;
    return (max === null ? cards : cards.filter((c) => !c.price || c.price.amount.amountMinor <= max)).slice(0, limit);
  };
  if (!terms.length) {
    const rows = await db.product.findMany({ where: scope, select: { id: true }, orderBy: { createdAt: "desc" }, take: 200 });
    const items = await pick(rows.map((r) => r.id));
    return { kind: items.length ? "all" : "none", items };
  }

  const all = await db.product.findMany({ where: { AND: [scope, ...terms.map(termWhere)] }, select: { id: true }, orderBy: { createdAt: "desc" }, take: 200 });
  if (all.length) {
    const items = await pick(all.map((r) => r.id));
    if (items.length) return { kind: "all", items };
  }

  if (terms.length > 1) {
    const any = await db.product.findMany({ where: { AND: [scope, { OR: terms.map(termWhere) }] }, select: { id: true, searchText: true }, take: 500 });
    const hits = (text: string) => terms.filter((t) => alternatives(t).some((a) => text.includes(a))).length;
    const ranked = any.map((r) => ({ id: r.id, n: hits(r.searchText) })).sort((a, b) => b.n - a.n);
    const items = await pick(ranked.map((r) => r.id));
    if (items.length) return { kind: "most", items };
  }

  const q = terms.join(" ");
  const close = await db.$queryRaw<{ id: string }[]>`
    SELECT p.id FROM "Product" p
    WHERE p.status = 'ACTIVE' AND word_similarity(${q}, p."searchText") >= 0.45
    ORDER BY word_similarity(${q}, p."searchText") DESC, p."createdAt" DESC
    LIMIT 100`;
  const inScope = close.length ? await db.product.findMany({ where: { AND: [scope, { id: { in: close.map((r) => r.id) } }] }, select: { id: true } }) : [];
  const keep = new Set(inScope.map((r) => r.id));
  const items = await pick(close.map((r) => r.id).filter((id) => keep.has(id)));
  return { kind: items.length ? "close" : "none", items };
}

/** Shop cards for products by address, in the order given. */
export async function cardsBySlug(db: Pick<PrismaClient, "product">, slugs: string[], ctx?: PriceContext): Promise<ProductCard[]> {
  if (!slugs.length) return [];
  const rows = await db.product.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true } });
  const id = new Map(rows.map((r) => [r.slug, r.id]));
  return cardsFor(db, slugs.flatMap((s) => (id.has(s) ? [id.get(s)!] : [])), ctx);
}
