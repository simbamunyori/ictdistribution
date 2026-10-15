import type { Prisma, PrismaClient, SpecField } from "@prisma/client";
import { cache } from "react";
import { formatSpec, mpnKey, searchTerms, type SpecValue, type SpecValues } from "@/lib/catalogue";
import { priceOf, usualPrice, volumeBreaksFor, volumeUnit, type PriceContext, type ShopPrice } from "@/server/shop/prices";
import { specFieldsOf } from "./categories";

/**
 * What the shop shows: categories, search, filters, product pages,
 * comparisons and suggestions. Never reads supplier offers. The landed
 * cost is read only to work out the shop price and never leaves this
 * file. Only ACTIVE products in visible categories appear.
 */

export const SHOP_PAGE_SIZE = 24;
/** Filtering and facets run over at most this many matches per request. Past that, D11's search index takes over. */
const MAX_MATCHES = 5000;

/** Products the shop may show: active, in a visible category whose parent (if any) is visible too. */
export const IN_SHOP: Prisma.ProductWhereInput = {
  status: "ACTIVE",
  category: { active: true, OR: [{ parentId: null }, { parent: { active: true } }] },
};

const CARD_SELECT = {
  id: true,
  slug: true,
  name: true,
  summary: true,
  mpn: true,
  specs: true,
  createdAt: true,
  sellToIndividuals: true,
  landedCostMinor: true,
  leadTimeDays: true,
  categoryId: true,
  brand: { select: { name: true, slug: true } },
  category: { select: { id: true, name: true, slug: true, parentId: true, specFields: { where: { highlight: true }, orderBy: { sortOrder: "asc" } }, parent: { select: { specFields: { where: { highlight: true }, orderBy: { sortOrder: "asc" } } } } } },
  media: { where: { kind: "IMAGE" }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], take: 1, select: { id: true, alt: true, width: true, height: true } },
} satisfies Prisma.ProductSelect;

type CardRow = Prisma.ProductGetPayload<{ select: typeof CARD_SELECT }>;

export interface ProductCard {
  id: string;
  slug: string;
  name: string;
  brand: string;
  mpn: string;
  summary: string;
  category: string;
  sellToIndividuals: boolean;
  image: { id: string; alt: string; width: number | null; height: number | null } | null;
  /** The category's highlighted specifications, written out: "16 GB", "Intel Core i7". */
  highlights: string[];
  /** For products sold to individuals, when it can be priced. */
  price: ShopPrice | null;
}

/** The shop price of a product row, for products sold to individuals. */
function priceRow(p: Pick<CardRow, "id" | "sellToIndividuals" | "landedCostMinor" | "leadTimeDays" | "categoryId"> & { category: { parentId: string | null } }, ctx?: PriceContext): ShopPrice | null {
  if (!ctx) return null;
  return priceOf(ctx, { id: p.id, sellToIndividuals: p.sellToIndividuals, categoryId: p.categoryId, parentCategoryId: p.category.parentId, landedCostMinor: p.landedCostMinor, leadTimeDays: p.leadTimeDays });
}

function toCard(p: CardRow, ctx?: PriceContext): ProductCard {
  const specs = p.specs as SpecValues;
  const fields = [...(p.category.parent?.specFields ?? []), ...p.category.specFields];
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    brand: p.brand.name,
    mpn: p.mpn,
    summary: p.summary,
    category: p.category.name,
    sellToIndividuals: p.sellToIndividuals,
    image: p.media[0] ?? null,
    highlights: fields.map((f) => formatSpec(f, specs[f.key])).filter(Boolean).slice(0, 4),
    price: priceRow(p, ctx),
  };
}

// ─── Categories ──────────────────────────────────────────────────────

/** Visible categories with their visible subcategories and how many products each has in the shop. */
export const shopCategories = cache(async (db: Pick<PrismaClient, "category" | "product">) => {
  const [tree, counts] = await Promise.all([
    db.category.findMany({ where: { parentId: null, active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { children: { where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] } } }),
    db.product.groupBy({ by: ["categoryId"], where: IN_SHOP, _count: { _all: true } }),
  ]);
  const n = new Map(counts.map((c) => [c.categoryId, c._count._all]));
  return tree.map((c) => {
    const children = c.children.map((s) => ({ id: s.id, slug: s.slug, name: s.name, count: n.get(s.id) ?? 0 }));
    return { id: c.id, slug: c.slug, name: c.name, description: c.description, count: (n.get(c.id) ?? 0) + children.reduce((a, s) => a + s.count, 0), children };
  });
});

// ─── Browsing and search ─────────────────────────────────────────────

export type SortOrder = "relevance" | "name" | "newest" | "price";

export interface BrowseParams {
  /** A category or subcategory slug. */
  category?: string;
  q?: string;
  /** Brand slugs. */
  brands?: string[];
  /** Chosen values by specification key. */
  values?: Record<string, string[]>;
  /** Number ranges by specification key. */
  ranges?: Record<string, { min?: number; max?: number }>;
  sort?: SortOrder;
  page?: number;
}

export interface Facet {
  field: Pick<SpecField, "key" | "label" | "kind" | "unit">;
  /** Values to tick, with how many products each would show. */
  options: { value: string; label: string; count: number; chosen: boolean }[];
  /** For numbers with many different values: the lowest and highest. */
  range?: { min: number; max: number; chosenMin?: number; chosenMax?: number };
}

/** A value as the filter compares it: numbers and yes/no as text. */
const asText = (v: SpecValue | undefined) => (v === undefined ? undefined : typeof v === "boolean" ? (v ? "yes" : "no") : String(v));

export async function browse(db: Pick<PrismaClient, "category" | "product">, params: BrowseParams, ctx?: PriceContext) {
  const terms = searchTerms(params.q ?? "");
  let category: Awaited<ReturnType<typeof findShopCategory>> = null;
  if (params.category) {
    category = await findShopCategory(db, params.category);
    if (!category) return null;
  }
  const fields = category ? specFieldsOf(category).filter((f) => f.filterable) : [];
  const categoryIds = category ? [category.id, ...category.children.filter((c) => c.active).map((c) => c.id)] : undefined;
  const rows = await db.product.findMany({
    where: {
      AND: [
        IN_SHOP,
        ...(categoryIds ? [{ categoryId: { in: categoryIds } }] : []),
        ...terms.map((t) => ({ OR: [{ searchText: { contains: t } }, ...(mpnKey(t).length >= 3 ? [{ mpnKey: { contains: mpnKey(t) } }] : [])] })),
      ],
    },
    select: CARD_SELECT,
    orderBy: { createdAt: "desc" },
    take: MAX_MATCHES,
  });

  const chosenBrands = new Set(params.brands ?? []);
  const values = params.values ?? {};
  const ranges = params.ranges ?? {};
  const passBrand = (p: CardRow) => !chosenBrands.size || chosenBrands.has(p.brand.slug);
  const passField = (p: CardRow, f: SpecField) => {
    const v = (p.specs as SpecValues)[f.key];
    const chosen = values[f.key];
    if (chosen?.length && !chosen.includes(asText(v) ?? "")) return false;
    const r = ranges[f.key];
    if (r && (r.min !== undefined || r.max !== undefined)) {
      if (typeof v !== "number") return false;
      if (r.min !== undefined && v < r.min) return false;
      if (r.max !== undefined && v > r.max) return false;
    }
    return true;
  };
  const passAllBut = (p: CardRow, skip: string | null) => (skip === "brand" || passBrand(p)) && fields.every((f) => f.key === skip || passField(p, f));

  const matches = rows.filter((p) => passAllBut(p, null));

  // Each facet counts what ticking one more value would show, given every other choice.
  const brandCounts = new Map<string, { name: string; count: number }>();
  for (const p of rows.filter((p) => passAllBut(p, "brand"))) {
    const b = brandCounts.get(p.brand.slug) ?? { name: p.brand.name, count: 0 };
    b.count++;
    brandCounts.set(p.brand.slug, b);
  }
  const brandFacet = [...brandCounts.entries()].map(([slug, b]) => ({ value: slug, label: b.name, count: b.count, chosen: chosenBrands.has(slug) })).sort((a, b) => a.label.localeCompare(b.label));

  const facets: Facet[] = [];
  for (const f of fields) {
    const pool = rows.filter((p) => passAllBut(p, f.key));
    const counts = new Map<string, number>();
    const numbers: number[] = [];
    for (const p of pool) {
      const v = (p.specs as SpecValues)[f.key];
      const t = asText(v);
      if (t === undefined) continue;
      counts.set(t, (counts.get(t) ?? 0) + 1);
      if (typeof v === "number") numbers.push(v);
    }
    const chosen = new Set(values[f.key] ?? []);
    if (f.kind === "NUMBER" && counts.size > 15) {
      const r = ranges[f.key] ?? {};
      facets.push({ field: f, options: [], range: { min: Math.min(...numbers), max: Math.max(...numbers), chosenMin: r.min, chosenMax: r.max } });
      continue;
    }
    if (!counts.size && !chosen.size) continue;
    const order = f.kind === "CHOICE" ? f.options : [...counts.keys()].sort((a, b) => (f.kind === "NUMBER" ? Number(a) - Number(b) : a.localeCompare(b)));
    const options = order
      .filter((v) => counts.has(v) || chosen.has(v))
      .map((v) => ({ value: v, label: f.kind === "YES_NO" ? (v === "yes" ? "Yes" : "No") : f.kind === "NUMBER" ? formatSpec(f, Number(v)) : v, count: counts.get(v) ?? 0, chosen: chosen.has(v) }));
    facets.push({ field: f, options });
  }

  const sort = params.sort === "price" && !ctx ? "newest" : (params.sort ?? (terms.length ? "relevance" : "newest"));
  const score = (p: CardRow) => {
    const name = `${p.brand.name} ${p.name}`.toLowerCase();
    return (terms.every((t) => name.includes(t)) ? 2 : 0) + (terms.some((t) => mpnKey(t) === mpnKey(p.mpn)) ? 4 : 0);
  };
  // Lowest first; products without a shown price last.
  const prices = sort === "price" ? new Map(matches.map((p) => [p.id, priceRow(p, ctx)?.amount.amountMinor ?? null])) : null;
  const byPrice = (a: CardRow, b: CardRow) => {
    const x = prices!.get(a.id) ?? null;
    const y = prices!.get(b.id) ?? null;
    if (x === null || y === null) return Number(x === null) - Number(y === null);
    return x < y ? -1 : x > y ? 1 : 0;
  };
  const sorted =
    sort === "name"
      ? [...matches].sort((a, b) => `${a.brand.name} ${a.name}`.localeCompare(`${b.brand.name} ${b.name}`))
      : sort === "relevance"
        ? [...matches].sort((a, b) => score(b) - score(a) || b.createdAt.getTime() - a.createdAt.getTime())
        : sort === "price"
          ? [...matches].sort(byPrice)
          : matches;
  const pages = Math.max(1, Math.ceil(sorted.length / SHOP_PAGE_SIZE));
  const page = Math.min(Math.max(1, params.page ?? 1), pages);
  return {
    category,
    terms,
    total: sorted.length,
    truncated: rows.length === MAX_MATCHES,
    page,
    pages,
    sort,
    items: sorted.slice((page - 1) * SHOP_PAGE_SIZE, page * SHOP_PAGE_SIZE).map((p) => toCard(p, ctx)),
    brands: brandFacet,
    facets,
  };
}

async function findShopCategory(db: Pick<PrismaClient, "category">, slug: string) {
  const c = await db.category.findUnique({
    where: { slug },
    include: {
      specFields: { orderBy: [{ sortOrder: "asc" }, { label: "asc" }] },
      parent: { include: { specFields: { orderBy: [{ sortOrder: "asc" }, { label: "asc" }] } } },
      children: { where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] },
    },
  });
  if (!c || !c.active || (c.parent && !c.parent.active)) return null;
  return c;
}

/** Reads filters from the address: b=brand, f.key=value, min.key and max.key. */
export function browseParamsFrom(search: Record<string, string | string[] | undefined>): BrowseParams {
  const all = (k: string) => {
    const v = search[k];
    return (Array.isArray(v) ? v : v === undefined ? [] : [v]).filter((x) => x !== "").slice(0, 30);
  };
  const values: Record<string, string[]> = {};
  const ranges: Record<string, { min?: number; max?: number }> = {};
  for (const k of Object.keys(search)) {
    const m = /^(f|min|max)\.([a-z][a-z0-9_]{0,39})$/.exec(k);
    if (!m) continue;
    if (m[1] === "f") values[m[2]] = all(k);
    else {
      const n = Number(all(k)[0]);
      if (all(k).length && Number.isFinite(n)) (ranges[m[2]] ??= {})[m[1] as "min" | "max"] = n;
    }
  }
  const sort = all("sort")[0];
  return {
    q: all("q")[0]?.slice(0, 120),
    brands: all("b"),
    values,
    ranges,
    sort: sort === "name" || sort === "newest" || sort === "relevance" || sort === "price" ? sort : undefined,
    page: Number(all("page")[0]) || 1,
  };
}

// ─── Product page ────────────────────────────────────────────────────

export async function shopProduct(db: Pick<PrismaClient, "product" | "categorySuggestion">, slug: string, ctx?: PriceContext) {
  const found = await db.product.findFirst({
    where: { slug, ...IN_SHOP },
    select: {
      id: true,
      slug: true,
      name: true,
      mpn: true,
      summary: true,
      description: true,
      specs: true,
      warrantyMonths: true,
      warrantyTerms: true,
      sellToIndividuals: true,
      categoryId: true,
      landedCostMinor: true,
      leadTimeDays: true,
      brand: { select: { name: true, slug: true } },
      category: {
        select: {
          id: true,
          name: true,
          slug: true,
          parentId: true,
          specFields: { orderBy: [{ sortOrder: "asc" }, { label: "asc" }] },
          parent: { select: { id: true, name: true, slug: true, specFields: { orderBy: [{ sortOrder: "asc" }, { label: "asc" }] } } },
        },
      },
      media: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true, kind: true, alt: true, width: true, height: true, filename: true, size: true } },
      links: { where: { related: IN_SHOP }, select: { related: { select: CARD_SELECT } } },
      linkedBy: { where: { product: IN_SHOP }, select: { product: { select: CARD_SELECT } } },
    },
  });
  if (!found) return null;
  // The cost stays here: only the price made from it goes on.
  const { landedCostMinor, leadTimeDays, ...p } = found;
  const fields = specFieldsOf(p.category);
  const specs = p.specs as SpecValues;
  const linked = [...p.links.map((l) => l.related), ...p.linkedBy.map((l) => l.product)];
  const priceable = { id: p.id, sellToIndividuals: p.sellToIndividuals, categoryId: p.categoryId, parentCategoryId: p.category.parentId, landedCostMinor, leadTimeDays };
  const usual = ctx ? usualPrice(ctx, priceable) : null;
  // Lower unit prices for buying more, from the price level's volume breaks.
  const volume = ctx && usual ? volumeBreaksFor(ctx, priceable).map((b) => ({ minQuantity: b.minQuantity, discountBps: b.discountBps, unit: volumeUnit(ctx, priceable, usual, b.minQuantity).unit })).reverse() : [];
  return {
    ...p,
    price: priceRow({ ...p, landedCostMinor, leadTimeDays }, ctx),
    volume,
    specRows: fields.map((f) => ({ label: f.label, value: formatSpec(f, specs[f.key]) })).filter((r) => r.value),
    images: p.media.filter((m) => m.kind === "IMAGE"),
    datasheets: p.media.filter((m) => m.kind === "DATASHEET"),
    goesWith: linked.map((l) => toCard(l, ctx)),
    suggested: await suggestions(db, p, fields, new Set([p.id, ...linked.map((l) => l.id)]), ctx),
  };
}

/**
 * Suggested items from the categories this one points to (set in the
 * admin area). Where both share a specification marked "must match",
 * such as the memory type, only matching products are suggested.
 */
async function suggestions(db: Pick<PrismaClient, "product" | "categorySuggestion">, p: { category: { id: string; parentId: string | null }; specs: Prisma.JsonValue }, fields: SpecField[], exclude: Set<string>, ctx?: PriceContext): Promise<ProductCard[]> {
  const from = [p.category.id, ...(p.category.parentId ? [p.category.parentId] : [])];
  const related = (await db.categorySuggestion.findMany({ where: { categoryId: { in: from } }, select: { relatedId: true } })).map((r) => r.relatedId);
  if (!related.length) return [];
  const specs = p.specs as SpecValues;
  const mine = new Map(fields.map((f) => [f.key, specs[f.key]]));
  const candidates = await db.product.findMany({
    where: { AND: [IN_SHOP, { id: { notIn: [...exclude] } }, { OR: [{ categoryId: { in: related } }, { category: { parentId: { in: related } } }] }] },
    select: { ...CARD_SELECT, category: { select: { ...CARD_SELECT.category.select, specFields: { orderBy: { sortOrder: "asc" } }, parent: { select: { specFields: { orderBy: { sortOrder: "asc" } } } } } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const scored = candidates.flatMap((c) => {
    const theirs = c.specs as SpecValues;
    const must = [...(c.category.parent?.specFields ?? []), ...c.category.specFields].filter((f) => f.mustMatch && mine.get(f.key) !== undefined && theirs[f.key] !== undefined);
    if (must.some((f) => asText(mine.get(f.key)) !== asText(theirs[f.key]))) return [];
    return [{ c, score: must.length }];
  });
  scored.sort((a, b) => b.score - a.score);
  // One per category first, so a laptop suggests memory and a bag rather than four bags.
  const picked: typeof scored = [];
  const seen = new Set<string>();
  for (const s of scored) {
    if (seen.has(s.c.category.id) || picked.length >= 4) continue;
    seen.add(s.c.category.id);
    picked.push(s);
  }
  for (const s of scored) if (!picked.includes(s) && picked.length < 4) picked.push(s);
  return picked.map((s) => toCard({ ...s.c, category: { ...s.c.category, specFields: s.c.category.specFields.filter((f) => f.highlight), parent: s.c.category.parent ? { specFields: s.c.category.parent.specFields.filter((f) => f.highlight) } : null } }, ctx));
}

// ─── Compare ─────────────────────────────────────────────────────────

/** Up to four products side by side, with a row for each specification any of them has. */
export async function compareProducts(db: Pick<PrismaClient, "product">, ids: string[], ctx?: PriceContext) {
  const rows = await db.product.findMany({
    where: { AND: [IN_SHOP, { id: { in: ids.slice(0, 4) } }] },
    select: {
      ...CARD_SELECT,
      warrantyMonths: true,
      category: { select: { id: true, name: true, slug: true, parentId: true, specFields: { orderBy: [{ sortOrder: "asc" }, { label: "asc" }] }, parent: { select: { specFields: { orderBy: [{ sortOrder: "asc" }, { label: "asc" }] } } } } },
    },
  });
  const products = ids.map((id) => rows.find((r) => r.id === id)).filter((r) => r !== undefined);
  const fieldsByKey = new Map<string, SpecField>();
  for (const p of products) for (const f of [...(p.category.parent?.specFields ?? []), ...p.category.specFields]) if (!fieldsByKey.has(f.key)) fieldsByKey.set(f.key, f);
  const specRows = [...fieldsByKey.values()]
    .map((f) => {
      const values = products.map((p) => formatSpec(f, (p.specs as SpecValues)[f.key]));
      return { key: f.key, label: f.label, values, differs: new Set(values).size > 1 };
    })
    .filter((r) => r.values.some(Boolean));
  const highlightOnly = (p: (typeof products)[number]): CardRow => ({ ...p, category: { ...p.category, specFields: p.category.specFields.filter((f) => f.highlight), parent: p.category.parent ? { specFields: p.category.parent.specFields.filter((f) => f.highlight) } : null } });
  return {
    products: products.map((p) => ({ ...toCard(highlightOnly(p), ctx), warrantyMonths: p.warrantyMonths })),
    rows: [
      { key: "brand", label: "Brand", values: products.map((p) => p.brand.name), differs: new Set(products.map((p) => p.brand.name)).size > 1 },
      { key: "category", label: "Category", values: products.map((p) => p.category.name), differs: new Set(products.map((p) => p.category.name)).size > 1 },
      ...specRows,
      { key: "warranty", label: "Warranty", values: products.map((p) => (p.warrantyMonths ? `${p.warrantyMonths} months` : "")), differs: new Set(products.map((p) => p.warrantyMonths)).size > 1 },
    ],
  };
}

// ─── Cards by id ─────────────────────────────────────────────────────

/** Shop cards for these products, in the order given, leaving out any not in the shop. */
export async function cardsFor(db: Pick<PrismaClient, "product">, ids: string[], ctx?: PriceContext): Promise<ProductCard[]> {
  if (!ids.length) return [];
  const rows = await db.product.findMany({ where: { AND: [IN_SHOP, { id: { in: ids } }] }, select: CARD_SELECT });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => (byId.has(id) ? [toCard(byId.get(id)!, ctx)] : []));
}
