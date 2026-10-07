import type { Prisma, PrismaClient } from "@prisma/client";
import type { Money } from "@/lib/money";
import { hashToken, newToken } from "@/server/auth/tokens";
import { IN_SHOP } from "@/server/catalogue/shop";
import { DomainError } from "@/server/errors";
import { bundlePrice, priceOf, type LoadedSpecial, type PriceableProduct, type PriceContext } from "./prices";

/**
 * Carts, for guests and signed-in customers alike: a cookie holds a
 * random token and the database keeps its hash. Lines are priced fresh
 * every time they are shown and again at checkout, so a price always
 * reflects the special, rate and cost in force at that moment.
 */

type Db = Pick<PrismaClient, "cart" | "cartLine" | "product" | "special" | "shopSettings">;

export async function findCart(db: Pick<PrismaClient, "cart">, token: string | undefined) {
  if (!token) return null;
  return db.cart.findUnique({ where: { tokenHash: hashToken(token) } });
}

/** The cart for this token, or a new one with a new token to store. */
export async function cartFor(db: Pick<PrismaClient, "cart">, token: string | undefined): Promise<{ id: string; token: string; created: boolean }> {
  const found = await findCart(db, token);
  if (found) return { id: found.id, token: token!, created: false };
  const fresh = newToken();
  const cart = await db.cart.create({ data: { tokenHash: hashToken(fresh) } });
  return { id: cart.id, token: fresh, created: true };
}

async function maxLine(db: Pick<PrismaClient, "shopSettings">) {
  return (await db.shopSettings.findUnique({ where: { id: "global" } }))?.maxLineQuantity ?? 10;
}

/** Adds a product or a bundle, or more of one already in the cart. */
export async function addToCart(db: Db, cartId: string, item: { productId?: string; bundleId?: string }, quantity = 1) {
  if (!Number.isInteger(quantity) || quantity < 1) throw new DomainError("invalid", "Choose how many.", "quantity");
  const max = await maxLine(db);
  if (item.productId) {
    const p = await db.product.findFirst({ where: { id: item.productId, ...IN_SHOP }, select: { id: true, sellToIndividuals: true } });
    if (!p) throw new DomainError("not-found", "That product isn't in the shop any more.");
    if (!p.sellToIndividuals) throw new DomainError("invalid", "Businesses buy this one through a trade account.");
  } else if (item.bundleId) {
    const s = await db.special.findUnique({ where: { id: item.bundleId }, select: { kind: true } });
    if (s?.kind !== "BUNDLE") throw new DomainError("not-found", "That bundle has ended.");
  } else throw new DomainError("invalid", "Choose something to add.");
  const where = item.productId ? { cartId_productId: { cartId, productId: item.productId } } : { cartId_bundleId: { cartId, bundleId: item.bundleId! } };
  const existing = await db.cartLine.findUnique({ where });
  const next = Math.min(max, (existing?.quantity ?? 0) + quantity);
  if (existing) await db.cartLine.update({ where: { id: existing.id }, data: { quantity: next } });
  else await db.cartLine.create({ data: { cartId, productId: item.productId ?? null, bundleId: item.bundleId ?? null, quantity: next } });
  await db.cart.update({ where: { id: cartId }, data: { updatedAt: new Date() } });
  return next;
}

/** Sets a line's quantity. Zero removes it. */
export async function setQuantity(db: Db, cartId: string, lineId: string, quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 0) throw new DomainError("invalid", "Enter a whole number.", "quantity");
  const line = await db.cartLine.findFirst({ where: { id: lineId, cartId } });
  if (!line) return;
  if (quantity === 0) await db.cartLine.delete({ where: { id: line.id } });
  else await db.cartLine.update({ where: { id: line.id }, data: { quantity: Math.min(quantity, await maxLine(db)) } });
}

export async function cartCount(db: Pick<PrismaClient, "cartLine">, cartId: string | undefined) {
  if (!cartId) return 0;
  return (await db.cartLine.aggregate({ where: { cartId }, _sum: { quantity: true } }))._sum.quantity ?? 0;
}

// ─── Pricing lines ───────────────────────────────────────────────────

export interface CartItem {
  id: string;
  productId: string | null;
  bundleId: string | null;
  quantity: number;
}

export interface PricedLine {
  id: string;
  kind: "product" | "bundle";
  productId: string | null;
  bundleId: string | null;
  href: string | null;
  name: string;
  brand: string;
  mpn: string;
  image: { id: string; alt: string } | null;
  quantity: number;
  /** The usual price of one. */
  usualUnit: Money | null;
  /** How many are at the special price, and that price. */
  specialUnits: number;
  specialUnit: Money | null;
  special: { id: string; name: string; endsAt: Date } | null;
  total: Money | null;
  /** Internal, for the order line: landed cost of one in the base currency. Never shown. */
  unitCostBase: bigint | null;
  /** For bundles: what is in it. */
  contents: { name: string; quantity: number }[];
  leadTimeDays: number | null;
  /** Why it can't be bought now. */
  problem: string | null;
}

const PRODUCT_SELECT = {
  id: true,
  slug: true,
  name: true,
  mpn: true,
  categoryId: true,
  sellToIndividuals: true,
  landedCostMinor: true,
  leadTimeDays: true,
  brand: { select: { name: true } },
  category: { select: { parentId: true } },
  media: { where: { kind: "IMAGE" as const }, orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }], take: 1, select: { id: true, alt: true } },
} satisfies Prisma.ProductSelect;

const priceable = (p: { id: string; categoryId: string; landedCostMinor: bigint | null; leadTimeDays: number | null; category: { parentId: string | null } }): PriceableProduct => ({
  id: p.id,
  categoryId: p.categoryId,
  parentCategoryId: p.category.parentId,
  landedCostMinor: p.landedCostMinor,
  leadTimeDays: p.leadTimeDays,
});

/**
 * Prices cart lines for one shopper. A special's per-order limit and the
 * units it has left are shared across the cart in line order; units past
 * them are at the usual price.
 */
export async function priceLines(db: Pick<PrismaClient, "product" | "special">, items: CartItem[], ctx: PriceContext): Promise<PricedLine[]> {
  const productIds = items.flatMap((i) => (i.productId ? [i.productId] : []));
  const bundles = items.flatMap((i) => (i.bundleId ? [i.bundleId] : []));
  const bundleRows = bundles.length ? await db.special.findMany({ where: { id: { in: bundles } }, select: { id: true, name: true, slug: true, items: { select: { productId: true, quantity: true } } } }) : [];
  const allIds = [...new Set([...productIds, ...bundleRows.flatMap((b) => b.items.map((i) => i.productId))])];
  const products = new Map((await db.product.findMany({ where: { id: { in: allIds }, ...IN_SHOP }, select: PRODUCT_SELECT })).map((p) => [p.id, p]));
  const priceables = new Map([...products.values()].map((p) => [p.id, priceable(p)]));
  const used = new Map<string, number>();
  const room = (s: { id: string; remaining: number | null; perOrderLimit: number | null }) => {
    const u = used.get(s.id) ?? 0;
    return Math.max(0, Math.min(s.remaining ?? Infinity, s.perOrderLimit ?? Infinity) - u);
  };
  const currency = ctx.market.currency;
  const m = (amountMinor: bigint): Money => ({ amountMinor, currency });

  return items.map((item): PricedLine => {
    const base = { id: item.id, productId: item.productId, bundleId: item.bundleId, quantity: item.quantity, specialUnits: 0, specialUnit: null, special: null, contents: [] as { name: string; quantity: number }[] };
    if (item.productId) {
      const p = products.get(item.productId);
      const common = { ...base, kind: "product" as const, href: p ? `/products/${p.slug}` : null, name: p?.name ?? "A product no longer in the shop", brand: p?.brand.name ?? "", mpn: p?.mpn ?? "", image: p?.media[0] ?? null, unitCostBase: p?.landedCostMinor ?? null, leadTimeDays: p?.leadTimeDays ?? null };
      const price = p && p.sellToIndividuals ? priceOf(ctx, priceables.get(p.id)!) : null;
      if (!price) return { ...common, usualUnit: null, total: null, problem: p ? "Not available to order right now." : "No longer in the shop." };
      const usual = price.was ?? price.amount;
      if (!price.special) return { ...common, usualUnit: usual, total: m(usual.amountMinor * BigInt(item.quantity)), problem: null };
      const n = Math.min(item.quantity, room(price.special));
      used.set(price.special.id, (used.get(price.special.id) ?? 0) + n);
      const total = price.amount.amountMinor * BigInt(n) + usual.amountMinor * BigInt(item.quantity - n);
      return { ...common, usualUnit: usual, specialUnits: n, specialUnit: n ? price.amount : null, special: n ? { id: price.special.id, name: price.special.name, endsAt: price.special.endsAt } : null, total: m(total), problem: null };
    }
    const row = bundleRows.find((b) => b.id === item.bundleId);
    const special = ctx.specials.find((s) => s.id === item.bundleId && s.kind === "BUNDLE");
    const contents = (row?.items ?? []).map((i) => ({ name: products.get(i.productId)?.name ?? "A product no longer in the shop", quantity: i.quantity }));
    const common = { ...base, kind: "bundle" as const, href: row ? `/specials#${row.slug}` : null, name: row?.name ?? "A bundle that has ended", brand: "", mpn: "", image: products.get(row?.items[0]?.productId ?? "")?.media[0] ?? null, contents, unitCostBase: null as bigint | null, leadTimeDays: null as number | null };
    const price = special ? bundlePrice(ctx, special as LoadedSpecial, priceables) : null;
    if (!special || !price) return { ...common, usualUnit: null, total: null, problem: "This bundle has ended or sold out." };
    const n = Math.min(item.quantity, room(special));
    used.set(special.id, (used.get(special.id) ?? 0) + n);
    if (n < item.quantity) return { ...common, usualUnit: price.was, specialUnits: n, specialUnit: price.amount, special: { id: special.id, name: special.name, endsAt: special.endsAt }, total: null, leadTimeDays: price.leadTimeDays, problem: n ? `Only ${n} available at this price. Change the quantity.` : "This bundle has sold out." };
    const cost = special.items.reduce<bigint | null>((sum, i) => {
      const c = products.get(i.productId)?.landedCostMinor;
      return sum === null || c === null || c === undefined ? null : sum + c * BigInt(i.quantity);
    }, 0n);
    return { ...common, usualUnit: price.was, specialUnits: n, specialUnit: price.amount, special: { id: special.id, name: special.name, endsAt: special.endsAt }, total: m(price.amount.amountMinor * BigInt(n)), unitCostBase: cost, leadTimeDays: price.leadTimeDays, problem: null };
  });
}

export async function cartLines(db: Pick<PrismaClient, "cartLine">, cartId: string): Promise<CartItem[]> {
  return db.cartLine.findMany({ where: { cartId }, orderBy: { addedAt: "asc" }, select: { id: true, productId: true, bundleId: true, quantity: true } });
}

/** The sum of the lines that can be bought. */
export function subtotal(lines: PricedLine[], currency: string): Money {
  return { amountMinor: lines.reduce((s, l) => s + (l.problem || !l.total ? 0n : l.total.amountMinor), 0n), currency };
}
