import { applyBps, currencyInfo, divRound, type Minor, type Money } from "./money";
import { convert, roundUpTo, withMarkup, type MarketConversion, type Rate } from "./pricing";
import { taxIncluded } from "./shop-pricing";

/**
 * Quote prices. Pure: the caller loads the costs, markups, market and
 * rate. Quotes are priced before tax, line by line, with the tax added
 * on the total, as businesses expect to read them. Every value used comes
 * from the admin area.
 */

export interface QuoteMarket extends MarketConversion {
  taxRateBps: number;
}

/** One unit's price before tax, in the market's currency: landed cost plus markup, converted and rounded up. */
export function quoteUnitPrice(landed: Money, markupBps: number, market: MarketConversion, rate: Rate | null): Money {
  return convert({ amountMinor: withMarkup(landed.amountMinor, markupBps), currency: landed.currency }, market, rate);
}

/** A price agreed with the customer includes tax; quotes show it before tax. */
export function agreedBeforeTax(agreedWithTax: Minor, taxRateBps: number): Minor {
  return agreedWithTax - taxIncluded(agreedWithTax, taxRateBps);
}

export interface QuoteTotals {
  subtotal: Minor;
  tax: Minor;
  total: Minor;
}

export function quoteTotals(lineTotals: Minor[], taxRateBps: number): QuoteTotals {
  const subtotal = lineTotals.reduce((s, n) => s + n, 0n);
  const tax = applyBps(subtotal, taxRateBps);
  return { subtotal, tax, total: subtotal + tax };
}

/**
 * An amount in the market's currency, back in the base currency, rounded
 * down (1 base = rate market), so revenue is never overstated when the
 * margin is checked.
 */
export function fromMarket(amount: Money, base: string, rate: Rate | null): Money {
  if (amount.currency === base) return amount;
  if (!rate) throw new Error(`No exchange rate from ${base} to ${amount.currency}.`);
  const from = 10n ** BigInt(currencyInfo(amount.currency).exponent);
  const to = 10n ** BigInt(currencyInfo(base).exponent);
  return { amountMinor: (amount.amountMinor * rate.den * to) / (rate.num * from), currency: base };
}

/** What is left of the price after the cost, in basis points of the price. Null when there is no price. */
export function marginBps(revenueBase: Minor, costBase: Minor): number | null {
  if (revenueBase <= 0n) return null;
  return Number(divRound((revenueBase - costBase) * 10_000n, revenueBase));
}

export interface AutomationRules {
  automationEnabled: boolean;
  maxAutoValueMinor: bigint;
  minMarginBps: number;
  minMatchConfidence: number;
}

export interface LineForRules {
  position: number;
  description: string;
  productId: string | null;
  matchConfidence: number;
  flagReason: string | null;
  unitPriceMinor: bigint | null;
}

/**
 * Why a priced quote can't go out by itself, in plain words for the
 * person checking it. Empty means every rule is met and it is sent.
 */
export function reviewReasons(
  rules: AutomationRules,
  q: { lines: LineForRules[]; subtotalBase: Minor | null; marginBps: number | null; knownCustomer: boolean; maxValueText: string; minMarginText: string },
): string[] {
  const reasons: string[] = [];
  if (!rules.automationEnabled) reasons.push("Automatic sending is switched off.");
  if (!q.lines.length) reasons.push("It has no lines.");
  for (const l of q.lines) {
    const name = `Line ${l.position}, ${l.description.slice(0, 60)}`;
    if (l.flagReason) reasons.push(`${name}: ${l.flagReason}`);
    else if (l.unitPriceMinor === null) reasons.push(`${name}: no price yet.`);
    else if (!l.productId) reasons.push(`${name}: not a product we list.`);
    else if (l.matchConfidence < rules.minMatchConfidence) reasons.push(`${name}: the match to our product needs checking.`);
  }
  if (q.subtotalBase !== null && q.subtotalBase > rules.maxAutoValueMinor) reasons.push(`It is above ${q.maxValueText}, the most that goes out by itself.`);
  if (q.marginBps !== null && q.marginBps < rules.minMarginBps) reasons.push(`Its margin is below ${q.minMarginText}.`);
  if (!q.knownCustomer) reasons.push("It came from someone without an account.");
  return reasons;
}

/** Rounds a price typed by staff up to the market's step, so quotes read like shop prices. */
export function roundPrice(amount: Minor, market: Pick<MarketConversion, "roundToMinor">): Minor {
  return roundUpTo(amount, market.roundToMinor);
}
