import type { CustomerTypeCode, Market, PrismaClient } from "@prisma/client";
import type { Money } from "@/lib/money";
import type { Rate } from "@/lib/pricing";
import { bestSpecial, discounted, priceUnder, shelfPrice, type SpecialTerms } from "@/lib/shop-pricing";
import { asRate, currentRate, pricingSettings } from "@/server/pricing/rates";

/**
 * Prices for one shopper, loaded once per request: their market, their
 * price level (Individual, or an approved business's type) with its
 * category markups and volume breaks, any prices agreed with their
 * organisation, and the specials open to them.
 *
 * Products not sold to individuals are priced only for approved
 * businesses. Everyone else sees them without a price.
 */

export type ShopMarketRow = Pick<Market, "code" | "name" | "currency" | "locale" | "timeZone" | "fxBufferBps" | "roundToMinor" | "taxRateBps" | "taxName">;

export interface LoadedSpecial extends SpecialTerms {
  kind: "PRODUCT" | "CATEGORY" | "BUNDLE";
  categoryId: string | null;
  items: { productId: string; quantity: number }[];
}

export interface PriceContext {
  market: ShopMarketRow;
  base: string;
  rate: Rate | null;
  /** Null when the base currency has no rate to this market's: nothing can be priced. */
  priced: boolean;
  /** The price level's own markup. */
  markupBps: number;
  /** Markups for some categories, in place of the level's own. */
  categoryMarkups: Map<string, number>;
  /** Highest quantity first. */
  volumeBreaks: VolumeBreakRule[];
  /** Prices agreed with the buyer's organisation, by product, including tax. */
  customerPrices: Map<string, bigint>;
  customerType: CustomerTypeCode;
  /** An approved business: sees trade prices and products sold only to businesses. */
  trade: boolean;
  organisationId: string | null;
  specials: LoadedSpecial[];
  now: Date;
}

export interface VolumeBreakRule {
  categoryId: string | null;
  minQuantity: number;
  discountBps: number;
}

const SPECIAL_SELECT = {
  id: true,
  name: true,
  slug: true,
  kind: true,
  categoryId: true,
  discountBps: true,
  priceMinor: true,
  endsAt: true,
  quantityLimit: true,
  quantityUsed: true,
  perOrderLimit: true,
  items: { select: { productId: true, quantity: true } },
} as const;

/** Specials running now in this market for this customer type. */
export function openSpecialsWhere(marketCode: string, customerType: CustomerTypeCode, now: Date) {
  return { active: true, startsAt: { lte: now }, endsAt: { gt: now }, OR: [{ marketCode: null }, { marketCode }], customerTypes: { has: customerType } };
}

type PricingDb = Pick<PrismaClient, "pricingSettings" | "exchangeRate" | "customerType" | "special" | "categoryMarkup" | "volumeBreak" | "customerPrice">;

/**
 * `customerType` is the level the shopper buys at: Individual for anyone
 * but an approved business. `organisationId` brings in the prices agreed
 * with that business.
 */
export async function priceContext(db: PricingDb, market: ShopMarketRow, customerType: CustomerTypeCode, now = new Date(), organisationId: string | null = null): Promise<PriceContext> {
  const settings = await pricingSettings(db);
  const base = settings.baseCurrency;
  const [rateRow, level, markups, breaks, agreed, specials] = await Promise.all([
    market.currency === base ? null : currentRate(db, base, market.currency),
    db.customerType.findUniqueOrThrow({ where: { code: customerType }, select: { markupBps: true } }),
    db.categoryMarkup.findMany({ where: { customerType }, select: { categoryId: true, markupBps: true } }),
    db.volumeBreak.findMany({ where: { customerType }, select: { categoryId: true, minQuantity: true, discountBps: true }, orderBy: { minQuantity: "desc" } }),
    organisationId ? db.customerPrice.findMany({ where: { organisationId, marketCode: market.code, OR: [{ validUntil: null }, { validUntil: { gt: now } }] }, select: { productId: true, priceMinor: true } }) : [],
    db.special.findMany({ where: openSpecialsWhere(market.code, customerType, now), select: SPECIAL_SELECT, orderBy: { endsAt: "asc" } }),
  ]);
  const rate = asRate(rateRow);
  return {
    market,
    base,
    rate,
    priced: market.currency === base || rate !== null,
    markupBps: level.markupBps,
    categoryMarkups: new Map(markups.map((m) => [m.categoryId, m.markupBps])),
    volumeBreaks: breaks,
    customerPrices: new Map(agreed.map((a) => [a.productId, a.priceMinor])),
    customerType,
    trade: customerType !== "INDIVIDUAL",
    organisationId,
    specials: specials.map((s) => ({ ...s, remaining: s.quantityLimit === null ? null : Math.max(0, s.quantityLimit - s.quantityUsed) })),
    now,
  };
}

export interface PricedSpecial {
  id: string;
  name: string;
  slug: string;
  endsAt: Date;
  remaining: number | null;
  perOrderLimit: number | null;
}

export interface ShopPrice {
  /** What it costs now, including tax. */
  amount: Money;
  /** The usual price, when a special makes it lower. */
  was: Money | null;
  special: PricedSpecial | null;
  /** A price agreed with the buyer's organisation. */
  agreed: boolean;
  /** Typical working days before we can send it. */
  leadTimeDays: number | null;
}

export interface PriceableProduct {
  id: string;
  sellToIndividuals: boolean;
  categoryId: string;
  parentCategoryId: string | null;
  landedCostMinor: bigint | null;
  leadTimeDays: number | null;
}

const pickSpecial = (s: LoadedSpecial): PricedSpecial => ({ id: s.id, name: s.name, slug: s.slug, endsAt: s.endsAt, remaining: s.remaining, perOrderLimit: s.perOrderLimit });

/** Whether this shopper may buy it at all: businesses-only products need an approved business. */
export function canBuy(ctx: Pick<PriceContext, "trade">, p: Pick<PriceableProduct, "sellToIndividuals">): boolean {
  return p.sellToIndividuals || ctx.trade;
}

/** The level's markup for a product: its category's, else its parent category's, else the level's own. */
export function markupFor(ctx: Pick<PriceContext, "markupBps" | "categoryMarkups">, p: Pick<PriceableProduct, "categoryId" | "parentCategoryId">): number {
  return ctx.categoryMarkups.get(p.categoryId) ?? (p.parentCategoryId ? ctx.categoryMarkups.get(p.parentCategoryId) : undefined) ?? ctx.markupBps;
}

/** The usual price for this shopper, without specials or volume breaks. Null when it can't be priced. */
export function usualPrice(ctx: PriceContext, p: PriceableProduct): Money | null {
  if (!canBuy(ctx, p) || !ctx.priced) return null;
  const agreed = ctx.customerPrices.get(p.id);
  if (agreed !== undefined) return { amountMinor: agreed, currency: ctx.market.currency };
  if (p.landedCostMinor === null) return null;
  return shelfPrice({ amountMinor: p.landedCostMinor, currency: ctx.base }, markupFor(ctx, p), ctx.market, ctx.rate);
}

/** The volume breaks that apply to a product, highest quantity first. */
export function volumeBreaksFor(ctx: Pick<PriceContext, "volumeBreaks" | "customerPrices">, p: Pick<PriceableProduct, "id" | "categoryId" | "parentCategoryId">): VolumeBreakRule[] {
  // An agreed price is already the customer's own; breaks don't stack on it.
  if (ctx.customerPrices.has(p.id)) return [];
  const seen = new Set<number>();
  return ctx.volumeBreaks.filter((b) => {
    if (b.categoryId !== null && b.categoryId !== p.categoryId && b.categoryId !== p.parentCategoryId) return false;
    if (seen.has(b.minQuantity)) return false;
    seen.add(b.minQuantity);
    return true;
  });
}

/** One unit's price when buying `quantity`, after the best volume break. */
export function volumeUnit(ctx: PriceContext, p: PriceableProduct, usual: Money, quantity: number): { unit: Money; discountBps: number } {
  let best = 0;
  for (const b of volumeBreaksFor(ctx, p)) if (quantity >= b.minQuantity && b.discountBps > best) best = b.discountBps;
  if (!best) return { unit: usual, discountBps: 0 };
  return { unit: { amountMinor: discounted(usual.amountMinor, best, ctx.market.roundToMinor), currency: usual.currency }, discountBps: best };
}

/** The price a shopper pays for one unit, with the best special that applies. */
export function priceOf(ctx: PriceContext, p: PriceableProduct): ShopPrice | null {
  const usual = usualPrice(ctx, p);
  if (!usual) return null;
  const agreed = ctx.customerPrices.has(p.id);
  const applies = ctx.specials.filter((s) => (s.kind === "PRODUCT" && s.items.some((i) => i.productId === p.id)) || (s.kind === "CATEGORY" && (s.categoryId === p.categoryId || s.categoryId === p.parentCategoryId)));
  const best = bestSpecial(applies, usual.amountMinor, ctx.market.roundToMinor);
  if (!best) return { amount: usual, was: null, special: null, agreed, leadTimeDays: p.leadTimeDays };
  return { amount: { amountMinor: best.price, currency: usual.currency }, was: usual, special: pickSpecial(best.special), agreed: false, leadTimeDays: p.leadTimeDays };
}

export interface BundlePrice {
  amount: Money;
  was: Money;
  special: PricedSpecial;
  leadTimeDays: number | null;
}

/** A bundle's price, from its products' usual prices. Null when any of them can't be priced. */
export function bundlePrice(ctx: PriceContext, special: LoadedSpecial, products: Map<string, PriceableProduct>): BundlePrice | null {
  let usual = 0n;
  let lead = 0;
  for (const item of special.items) {
    const p = products.get(item.productId);
    const u = p ? usualPrice(ctx, p) : null;
    if (!p || !u) return null;
    usual += u.amountMinor * BigInt(item.quantity);
    lead = Math.max(lead, p.leadTimeDays ?? 0);
  }
  const price = priceUnder(special, usual, ctx.market.roundToMinor);
  if (price === null || (special.remaining !== null && special.remaining <= 0)) return null;
  const currency = ctx.market.currency;
  return { amount: { amountMinor: price, currency }, was: { amountMinor: usual, currency }, special: pickSpecial(special), leadTimeDays: lead || null };
}
