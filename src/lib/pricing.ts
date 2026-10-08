import { currencyInfo, divCeil, divRound, type Minor, type Money } from "./money";

/**
 * Turning our prices into what a customer pays. Pure and exact: rates are
 * decimal text, amounts are bigint minor units, and nothing passes
 * through a float. Every value it uses (markups, buffers, rounding) comes
 * from the admin area.
 */

/** An exchange rate as an exact fraction: 1 base = num / den quote. */
export interface Rate {
  num: bigint;
  den: bigint;
}

const RATE_TEXT = /^(\d{1,12})(?:\.(\d{1,12}))?$/;

/** Reads "18.2345" exactly. Refuses zero, negatives, exponents and more than 12 decimals. */
export function parseRate(text: string): Rate {
  const m = RATE_TEXT.exec(text.trim());
  if (!m) throw new Error(`"${text}" is not an exchange rate.`);
  const frac = m[2] ?? "";
  const den = 10n ** BigInt(frac.length);
  const num = BigInt(m[1]) * den + BigInt(frac || "0");
  if (num === 0n) throw new Error("An exchange rate can't be zero.");
  return { num, den };
}

/** Writes a JavaScript number from a rate feed as exact decimal text, to at most 12 decimals. */
export function rateText(value: number): string {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${value} is not an exchange rate.`);
  return value.toFixed(12).replace(/\.?0+$/, "");
}

/** How far a rate moved, in basis points of the old one, rounded to the nearest. */
export function movedBps(from: Rate, to: Rate): number {
  // |to/from - 1| * 10,000 = |to.num*from.den - from.num*to.den| * 10,000 / (from.num * to.den)
  const diff = to.num * from.den - from.num * to.den;
  return Number(divRound((diff < 0n ? -diff : diff) * 10_000n, from.num * to.den));
}

/** Cost plus the customer type's markup. Rounds half away from zero. */
export function withMarkup(cost: Minor, markupBps: number): Minor {
  if (markupBps < 0) throw new Error("A markup can't be negative.");
  return divRound(cost * BigInt(10_000 + markupBps), 10_000n);
}

/** Rounds up to a multiple of `step` minor units. 0 or 1 leaves the amount as it is. */
export function roundUpTo(amount: Minor, step: number): Minor {
  if (step <= 1) return amount;
  const s = BigInt(step);
  return divCeil(amount, s) * s;
}

export interface MarketConversion {
  currency: string;
  /** Basis points added to the rate. */
  fxBufferBps: number;
  /** Round the result up to a multiple of this many minor units. */
  roundToMinor: number;
}

/**
 * An amount in our base currency, in the market's currency: through the
 * rate plus the market's buffer, then rounded up. The same currency
 * needs no rate and gets no buffer, but is still rounded.
 */
export function convert(amount: Money, market: MarketConversion, rate: Rate | null): Money {
  if (amount.currency === market.currency) return { amountMinor: roundUpTo(amount.amountMinor, market.roundToMinor), currency: market.currency };
  if (!rate) throw new Error(`No exchange rate from ${amount.currency} to ${market.currency}.`);
  const from = 10n ** BigInt(currencyInfo(amount.currency).exponent);
  const to = 10n ** BigInt(currencyInfo(market.currency).exponent);
  const raw = divCeil(amount.amountMinor * rate.num * BigInt(10_000 + market.fxBufferBps) * to, rate.den * 10_000n * from);
  return { amountMinor: roundUpTo(raw, market.roundToMinor), currency: market.currency };
}

/** What a customer pays for something that costs us `cost`: markup, then conversion. */
export function customerPrice(cost: Money, markupBps: number, market: MarketConversion, rate: Rate | null): Money {
  return convert({ amountMinor: withMarkup(cost.amountMinor, markupBps), currency: cost.currency }, market, rate);
}
