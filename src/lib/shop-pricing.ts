import { applyBps, divRound, type Minor, type Money } from "./money";
import { convert, roundUpTo, withMarkup, type MarketConversion, type Rate } from "./pricing";

/**
 * Shop prices. Pure: the caller loads the landed cost, the customer
 * type's markup, the market and the rate in use. Shop prices include the
 * market's sales tax and are rounded up to the market's step, so a shelf
 * price reads "P 8,999", not "P 8,998.73".
 */

export interface ShopMarket extends MarketConversion {
  taxRateBps: number;
}

/** Landed cost, plus markup, plus tax, in the market's currency. */
export function shelfPrice(landed: Money, markupBps: number, market: ShopMarket, rate: Rate | null): Money {
  const net = withMarkup(landed.amountMinor, markupBps);
  const gross = net + applyBps(net, market.taxRateBps);
  return convert({ amountMinor: gross, currency: landed.currency }, market, rate);
}

/** The tax inside a price that includes it. */
export function taxIncluded(gross: Minor, taxRateBps: number): Minor {
  if (taxRateBps <= 0) return 0n;
  return gross - divRound(gross * 10_000n, BigInt(10_000 + taxRateBps));
}

/** A percentage off, rounded up to the market's step. */
export function discounted(price: Minor, discountBps: number, step: number): Minor {
  return roundUpTo(price - applyBps(price, discountBps), step);
}

export interface SpecialTerms {
  id: string;
  name: string;
  slug: string;
  discountBps: number | null;
  /** A fixed price in the market's currency, including tax. */
  priceMinor: bigint | null;
  endsAt: Date;
  /** Units left at this price. Null: no limit. */
  remaining: number | null;
  perOrderLimit: number | null;
}

/** The price under one special, given the usual price. A fixed price above the usual one is no special at all. */
export function priceUnder(special: Pick<SpecialTerms, "discountBps" | "priceMinor">, usual: Minor, step: number): Minor | null {
  const p = special.priceMinor !== null ? special.priceMinor : special.discountBps !== null ? discounted(usual, special.discountBps, step) : null;
  return p !== null && p < usual ? p : null;
}

/** The lowest price among the specials that apply, with the special that gives it. */
export function bestSpecial<S extends Pick<SpecialTerms, "discountBps" | "priceMinor" | "remaining">>(specials: S[], usual: Minor, step: number): { special: S; price: Minor } | null {
  let best: { special: S; price: Minor } | null = null;
  for (const s of specials) {
    if (s.remaining !== null && s.remaining <= 0) continue;
    const p = priceUnder(s, usual, step);
    if (p !== null && (!best || p < best.price)) best = { special: s, price: p };
  }
  return best;
}

export interface DeliveryTerms {
  deliveryEnabled: boolean;
  deliveryFeeMinor: bigint;
  freeDeliveryMinor: bigint | null;
}

/** The delivery fee for an order of this subtotal, or null when the market doesn't deliver. */
export function deliveryFee(subtotal: Minor, m: DeliveryTerms): Minor | null {
  if (!m.deliveryEnabled) return null;
  if (m.freeDeliveryMinor !== null && subtotal >= m.freeDeliveryMinor) return 0n;
  return m.deliveryFeeMinor;
}

/** "Ends in 2 days", "Ends in 3 h 20 min", for a countdown. */
export function timeLeft(end: Date, now: Date): string {
  const ms = end.getTime() - now.getTime();
  if (ms <= 0) return "Ended";
  const min = Math.floor(ms / 60_000);
  const days = Math.floor(min / 1440);
  const hours = Math.floor((min % 1440) / 60);
  const mins = min % 60;
  if (days >= 2) return `Ends in ${days} days`;
  if (days === 1) return `Ends in 1 day ${hours} h`;
  if (hours >= 1) return `Ends in ${hours} h ${mins} min`;
  return `Ends in ${Math.max(1, mins)} min`;
}
