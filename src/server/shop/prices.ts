import type { CustomerTypeCode, Market, PrismaClient } from "@prisma/client";
import type { Money } from "@/lib/money";
import type { Rate } from "@/lib/pricing";
import { bestSpecial, priceUnder, shelfPrice, type SpecialTerms } from "@/lib/shop-pricing";
import { asRate, currentRate, pricingSettings } from "@/server/pricing/rates";

/**
 * Prices for one shopper: their market, their customer type and the
 * specials open to them, loaded once per request. Shop prices are retail
 * (the Individual price level) for everyone until trade pricing arrives
 * in D4; specials can still be limited to customer types.
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
  markupBps: number;
  customerType: CustomerTypeCode;
  specials: LoadedSpecial[];
  now: Date;
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

export async function priceContext(db: Pick<PrismaClient, "pricingSettings" | "exchangeRate" | "customerType" | "special">, market: ShopMarketRow, customerType: CustomerTypeCode, now = new Date()): Promise<PriceContext> {
  const settings = await pricingSettings(db);
  const base = settings.baseCurrency;
  const [rateRow, retail, specials] = await Promise.all([
    market.currency === base ? null : currentRate(db, base, market.currency),
    db.customerType.findUniqueOrThrow({ where: { code: "INDIVIDUAL" }, select: { markupBps: true } }),
    db.special.findMany({ where: openSpecialsWhere(market.code, customerType, now), select: SPECIAL_SELECT, orderBy: { endsAt: "asc" } }),
  ]);
  const rate = asRate(rateRow);
  return {
    market,
    base,
    rate,
    priced: market.currency === base || rate !== null,
    markupBps: retail.markupBps,
    customerType,
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
  /** Typical working days before we can send it. */
  leadTimeDays: number | null;
}

export interface PriceableProduct {
  id: string;
  categoryId: string;
  parentCategoryId: string | null;
  landedCostMinor: bigint | null;
  leadTimeDays: number | null;
}

const pickSpecial = (s: LoadedSpecial): PricedSpecial => ({ id: s.id, name: s.name, slug: s.slug, endsAt: s.endsAt, remaining: s.remaining, perOrderLimit: s.perOrderLimit });

/** The usual retail price, without specials. Null when it has no usable offer or no rate. */
export function usualPrice(ctx: PriceContext, p: Pick<PriceableProduct, "landedCostMinor">): Money | null {
  if (p.landedCostMinor === null || !ctx.priced) return null;
  return shelfPrice({ amountMinor: p.landedCostMinor, currency: ctx.base }, ctx.markupBps, ctx.market, ctx.rate);
}

/** The price a shopper pays for one unit, with the best special that applies. */
export function priceOf(ctx: PriceContext, p: PriceableProduct): ShopPrice | null {
  const usual = usualPrice(ctx, p);
  if (!usual) return null;
  const applies = ctx.specials.filter((s) => (s.kind === "PRODUCT" && s.items.some((i) => i.productId === p.id)) || (s.kind === "CATEGORY" && (s.categoryId === p.categoryId || s.categoryId === p.parentCategoryId)));
  const best = bestSpecial(applies, usual.amountMinor, ctx.market.roundToMinor);
  if (!best) return { amount: usual, was: null, special: null, leadTimeDays: p.leadTimeDays };
  return { amount: { amountMinor: best.price, currency: usual.currency }, was: usual, special: pickSpecial(best.special), leadTimeDays: p.leadTimeDays };
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
