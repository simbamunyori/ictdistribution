import { currencyInfo, divRound } from "./money";
import { parseRate, type Rate } from "./pricing";

/**
 * Sums for the finance reports. Each order counts in the base currency at
 * the rate in use on the day it was placed, so a period's figures do not
 * move when rates do.
 */

export interface DatedRate {
  quote: string;
  rate: string;
  fetchedAt: Date;
}

/** Rates by currency, oldest first, for finding the one in use on a day. */
export function rateBook(rows: DatedRate[]): Map<string, { at: number; rate: Rate }[]> {
  const book = new Map<string, { at: number; rate: Rate }[]>();
  for (const r of [...rows].sort((a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime())) {
    const list = book.get(r.quote) ?? [];
    list.push({ at: r.fetchedAt.getTime(), rate: parseRate(r.rate) });
    book.set(r.quote, list);
  }
  return book;
}

/** The rate in use at `when`: the newest fetched by then, or the first ever when none was yet. */
export function rateAt(book: Map<string, { at: number; rate: Rate }[]>, currency: string, when: Date): Rate | null {
  const list = book.get(currency);
  if (!list?.length) return null;
  const t = when.getTime();
  let lo = 0;
  let hi = list.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].at <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return list[found === -1 ? 0 : found].rate;
}

/** An amount in `currency` in the base currency, with a rate given as `currency` per one base unit. Null when there is no rate. */
export function inBase(amountMinor: bigint, currency: string, base: string, rate: Rate | null): bigint | null {
  if (currency === base) return amountMinor;
  if (!rate) return null;
  const from = 10n ** BigInt(currencyInfo(currency).exponent);
  const to = 10n ** BigInt(currencyInfo(base).exponent);
  return divRound(amountMinor * rate.den * to, rate.num * from);
}

/** Margin as a share of sales, in basis points. Null when there were no sales. */
export function marginBps(salesMinor: bigint, costMinor: bigint): number | null {
  if (salesMinor === 0n) return null;
  return Number(((salesMinor - costMinor) * 10_000n) / salesMinor);
}

export const percent = (bps: number | null) => (bps === null ? "" : `${(bps / 100).toFixed(1)}%`);

/** Middle value of a list of durations, or null when empty. */
export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

export function average(xs: number[]): number | null {
  return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
}

/** Days overdue, grouped as accountants read an aged debt list. */
export type AgeBand = "current" | "d1_30" | "d31_60" | "d61_90" | "d90";

export const AGE_BAND_LABEL: Record<AgeBand, string> = {
  current: "Not yet due",
  d1_30: "1 to 30 days",
  d31_60: "31 to 60 days",
  d61_90: "61 to 90 days",
  d90: "Over 90 days",
};
export const AGE_BANDS = Object.keys(AGE_BAND_LABEL) as AgeBand[];

export function ageBand(daysOverdue: number): AgeBand {
  if (daysOverdue <= 0) return "current";
  if (daysOverdue <= 30) return "d1_30";
  if (daysOverdue <= 60) return "d31_60";
  if (daysOverdue <= 90) return "d61_90";
  return "d90";
}

/** Whole days from `due` to `now`; zero or less while not yet due. */
export function daysOverdue(due: Date, now: Date): number {
  return Math.floor((now.getTime() - due.getTime()) / 86_400_000);
}
