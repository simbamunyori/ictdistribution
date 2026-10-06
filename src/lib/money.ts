/**
 * Money is always an integer count of minor units (thebe for BWP, cents
 * for dollars) held in a bigint, and always travels with its currency
 * code. Floats never touch an amount.
 */

export type Minor = bigint;

export interface Money {
  amountMinor: Minor;
  /** ISO 4217, e.g. "BWP". */
  currency: string;
}

interface CurrencyInfo {
  /** Digits after the decimal point, from the currency's ISO definition. */
  exponent: number;
}

const infoCache = new Map<string, CurrencyInfo>();

/** Facts about a currency, from Intl. There is no table of currencies to keep up to date. */
export function currencyInfo(currency: string): CurrencyInfo {
  let info = infoCache.get(currency);
  if (!info) {
    if (!isSupportedCurrency(currency)) throw new Error(`Unsupported currency ${currency}.`);
    info = { exponent: new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2 };
    infoCache.set(currency, info);
  }
  return info;
}

const KNOWN = new Set(Intl.supportedValuesOf("currency"));

export function isSupportedCurrency(currency: string): boolean {
  return KNOWN.has(currency);
}

/** "Botswanan Pula", for sentences. */
export function currencyName(currency: string, locale: string): string {
  return new Intl.DisplayNames([locale], { type: "currency" }).of(currency) ?? currency;
}

/** What the locale writes before or after an amount: "P", "R", "US$". */
export function currencySymbol(currency: string, locale: string): string {
  return formatter(locale, currency, false).formatToParts(0).find((p) => p.type === "currency")?.value ?? currency;
}

export function money(amountMinor: Minor, currency: string): Money {
  currencyInfo(currency);
  return { amountMinor, currency };
}

export class CurrencyMismatchError extends Error {
  constructor(a: string, b: string) {
    super(`Cannot combine ${a} and ${b} amounts.`);
    this.name = "CurrencyMismatchError";
  }
}

function same(a: Money, b: Money) {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
}

export function add(a: Money, b: Money): Money {
  same(a, b);
  return { amountMinor: a.amountMinor + b.amountMinor, currency: a.currency };
}

export function subtract(a: Money, b: Money): Money {
  same(a, b);
  return { amountMinor: a.amountMinor - b.amountMinor, currency: a.currency };
}

export function times(a: Money, quantity: number | bigint): Money {
  const q = BigInt(quantity);
  return { amountMinor: a.amountMinor * q, currency: a.currency };
}

/** Adds up amounts in one currency. An empty list is zero in `currency`. */
export function total(amounts: Iterable<Money>, currency: string): Money {
  let sum = 0n;
  for (const a of amounts) {
    if (a.currency !== currency) throw new CurrencyMismatchError(currency, a.currency);
    sum += a.amountMinor;
  }
  return { amountMinor: sum, currency };
}

export function sum(amounts: Iterable<Minor>): Minor {
  let t = 0n;
  for (const a of amounts) t += a;
  return t;
}

/** Integer division rounding half away from zero. */
export function divRound(n: bigint, d: bigint): bigint {
  if (d === 0n) throw new Error("Division by zero.");
  const negative = n < 0n !== d < 0n;
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const q = (an * 2n + ad) / (ad * 2n);
  return negative ? -q : q;
}

/** Integer division rounding up (towards positive infinity). */
export function divCeil(n: bigint, d: bigint): bigint {
  if (d <= 0n) throw new Error("Divisor must be positive.");
  return n >= 0n ? (n + d - 1n) / d : -(-n / d);
}

/** Basis points: 10,000 is 100%. Rounds half away from zero. */
export function applyBps(amount: Minor, bps: number | bigint): Minor {
  return divRound(amount * BigInt(bps), 10_000n);
}

export class MoneyParseError extends Error {
  constructor(input: string, reason: string) {
    super(`Cannot read "${input}" as an amount: ${reason}`);
    this.name = "MoneyParseError";
  }
}

/**
 * Parses what a person types ("12,400", "P 12 400.5", "12400.50", or
 * "R 1 234,50" in a locale with a decimal comma) into minor units.
 * Rejects more decimals than the currency has rather than rounding.
 */
export function parseMoney(input: string, currency: string, locale = "en"): Minor {
  const { exponent } = currencyInfo(currency);
  const decimal = formatter(locale, currency, false).formatToParts(1.5).find((p) => p.type === "decimal")?.value ?? ".";
  const raw = input.trim();
  let s = raw;
  let negative = false;
  if (/^[-−]/.test(s)) {
    negative = true;
    s = s.slice(1);
  }
  // Whatever currency code or symbol comes first: letters and symbols, not digits.
  s = s.replace(/^[^\d\-−.,]+/u, "");
  if (!negative && /^[-−]/.test(s)) {
    negative = true;
    s = s.slice(1);
  }
  // With a decimal comma, a comma marks the decimals and dots group
  // thousands. People there often type a dot anyway, so without a comma a
  // dot is the decimal point.
  s = decimal === "," && s.includes(",") ? s.replace(/[\s.\u00a0\u202f]/gu, "").replace(",", ".") : s.replace(/[\s,\u00a0\u202f]/gu, "");
  const pattern = new RegExp(`^\\d+(\\.\\d{0,${exponent}})?$`);
  if (!pattern.test(s)) {
    throw new MoneyParseError(raw, new RegExp(`\\.\\d{${exponent + 1},}$`).test(s) ? "too many decimal places" : "not a number");
  }
  const [whole, frac = ""] = s.split(".");
  const scale = 10n ** BigInt(exponent);
  const value = BigInt(whole) * scale + BigInt((frac + "0".repeat(exponent)).slice(0, exponent) || "0");
  return negative ? -value : value;
}

/** An amount as a person would type it, without the currency: "1900.00". Round-trips through parseMoney. */
export function toPlainAmount(m: Money): string {
  const { exponent } = currencyInfo(m.currency);
  const negative = m.amountMinor < 0n;
  const digits = (negative ? -m.amountMinor : m.amountMinor).toString().padStart(exponent + 1, "0");
  const plain = exponent ? `${digits.slice(0, -exponent)}.${digits.slice(-exponent)}` : digits;
  return negative ? `-${plain}` : plain;
}

export interface FormatOptions {
  /** Always show a sign, e.g. "+P 1.00" for a credit. */
  signed?: boolean;
  /** Hide the currency, for dense table columns. */
  bare?: boolean;
}

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(locale: string, currency: string, signed: boolean): Intl.NumberFormat {
  const key = `${locale}|${currency}|${signed}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, { style: "currency", currency, signDisplay: signed ? "exceptZero" : "auto" });
    formatters.set(key, f);
  }
  return f;
}

/**
 * The one way an amount becomes text: "P 12,400.00" in en-BW, "R 12 400,00"
 * in en-ZA, "US$12,400.00" in en-ZW. The locale is the customer's market's.
 * Formats the exact decimal, so no amount passes through a float, and uses
 * a true minus sign (U+2212), never brackets.
 */
export function formatMoney(m: Money, locale: string, opts: FormatOptions = {}): string {
  const parts = formatter(locale, m.currency, opts.signed ?? false).formatToParts(toPlainAmount(m) as Intl.StringNumericLiteral);
  let out = "";
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (opts.bare && (p.type === "currency" || (p.type === "literal" && /^\s+$/u.test(p.value) && (parts[i - 1]?.type === "currency" || parts[i + 1]?.type === "currency")))) continue;
    out += p.type === "minusSign" ? "−" : p.value;
  }
  return out;
}

/** Plain JSON for money crossing to the browser, where bigint can't go. */
export interface MoneyJson {
  amountMinor: string;
  currency: string;
}

export function toJson(m: Money): MoneyJson {
  return { amountMinor: m.amountMinor.toString(), currency: m.currency };
}

export function fromJson(j: MoneyJson): Money {
  if (!/^-?\d+$/.test(j.amountMinor)) throw new Error("Invalid amount.");
  return money(BigInt(j.amountMinor), j.currency);
}
