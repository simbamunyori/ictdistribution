import type { Market } from "@prisma/client";

/** Choosing a market for a visitor or a new account. Pure, so it is tested without a database. */

export type MarketRow = Pick<Market, "code" | "country" | "enabled" | "isDefault">;

/** The cookie that remembers the market a visitor chose. */
export const MARKET_COOKIE = "market";

/** The enabled market for a country, or null when we don't sell there yet. */
export function marketForCountry<M extends MarketRow>(country: string, markets: M[]): M | null {
  const code = country.toUpperCase();
  return markets.find((m) => m.enabled && m.country === code) ?? null;
}

/** The market visitors get when theirs can't be told or is switched off. */
export function defaultMarket<M extends MarketRow>(markets: M[]): M {
  const m = markets.find((x) => x.isDefault && x.enabled) ?? markets.find((x) => x.enabled);
  if (!m) throw new Error("No market is switched on.");
  return m;
}

export type MarketReason = "account" | "cookie" | "country" | "default";

/**
 * The market for a visitor: their account's, else the one they chose
 * (the cookie), else the one for their country, else the default. A
 * market that is switched off falls through to the next.
 */
export function chooseMarket<M extends MarketRow>(markets: M[], visitor: { account?: string | null; cookie?: string | null; country?: string | null }): { market: M; reason: MarketReason } {
  const on = (code: string | null | undefined) => (code ? markets.find((m) => m.enabled && m.code === code) : undefined);
  const account = on(visitor.account);
  if (account) return { market: account, reason: "account" };
  const chosen = on(visitor.cookie);
  if (chosen) return { market: chosen, reason: "cookie" };
  const byCountry = visitor.country ? marketForCountry(visitor.country, markets) : null;
  if (byCountry) return { market: byCountry, reason: "country" };
  return { market: defaultMarket(markets), reason: "default" };
}
