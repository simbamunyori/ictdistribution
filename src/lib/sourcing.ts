import type { SourcingRule } from "@prisma/client";
import { applyBps, type Money } from "./money";
import { toBase, type Rate } from "./pricing";

/**
 * Choosing which supplier to buy a product from. Pure: the caller loads
 * the offers and the rates in use. The rule (cheapest landed cost,
 * fastest, preferred) is set in the admin area per product, per category
 * or for everything.
 */

export const SOURCING_RULE_LABEL: Record<SourcingRule, string> = {
  CHEAPEST_LANDED: "Cheapest landed cost",
  FASTEST: "Fastest",
  PREFERRED: "Preferred supplier",
};

export const SOURCING_RULE_DESCRIPTION: Record<SourcingRule, string> = {
  CHEAPEST_LANDED: "The lowest cost once freight, duties and clearing are added. Ties go to the fastest.",
  FASTEST: "The shortest lead time. Ties go to the cheapest.",
  PREFERRED: "Suppliers marked preferred first, the cheapest of them. Others only when no preferred supplier offers it.",
};

export interface OfferForChoice {
  id: string;
  costMinor: bigint;
  currency: string;
  /** Null uses the supplier's typical lead time. */
  leadTimeDays: number | null;
  stock: number | null;
  active: boolean;
  supplier: { id: string; name: string; active: boolean; preferred: boolean; leadTimeDays: number; landedCostBps: number };
}

export interface RankedOffer<O extends OfferForChoice> {
  offer: O;
  /** Cost plus freight, insurance, duty and clearing (or the supplier's allowance when those can't be estimated), in the base currency. Null when it can't be worked out. */
  landed: Money | null;
  leadTimeDays: number;
  /** Why it can't be chosen, when it can't. */
  unavailable?: string;
}

export interface Choice<O extends OfferForChoice> {
  rule: SourcingRule;
  chosen: RankedOffer<O> | null;
  /** Every offer, best first, the ones that can't be chosen last. */
  ranked: RankedOffer<O>[];
}

/** Which rule applies: the product's, else its category's, else the parent category's, else the global one. */
export function resolveRule(...rules: (SourcingRule | null | undefined)[]): SourcingRule {
  for (const r of rules) if (r) return r;
  return "CHEAPEST_LANDED";
}

/**
 * Freight, insurance, duty and clearing for one unit from an offer, in the
 * base currency, given its cost in the base currency. Null when they can't
 * be estimated, and the supplier's landed cost allowance is used instead.
 */
export type LandedAdd<O> = (offer: O, costBase: bigint) => bigint | null;

export function chooseOffer<O extends OfferForChoice>(offers: O[], rule: SourcingRule, base: string, rates: (currency: string) => Rate | null, landedAdd?: LandedAdd<O>): Choice<O> {
  const ranked: RankedOffer<O>[] = offers.map((offer) => {
    const leadTimeDays = offer.leadTimeDays ?? offer.supplier.leadTimeDays;
    let landed: Money | null = null;
    if (offer.costMinor > 0n) {
      const rate = offer.currency === base ? null : rates(offer.currency);
      if (offer.currency === base || rate) {
        const costBase = toBase({ amountMinor: offer.costMinor, currency: offer.currency }, base, rate).amountMinor;
        const add = landedAdd?.(offer, costBase) ?? null;
        landed = add !== null ? { amountMinor: costBase + add, currency: base } : toBase({ amountMinor: offer.costMinor + applyBps(offer.costMinor, offer.supplier.landedCostBps), currency: offer.currency }, base, rate);
      }
    }
    let unavailable: string | undefined;
    if (!offer.supplier.active) unavailable = "Supplier switched off";
    else if (!offer.active) unavailable = "Offer switched off";
    else if (offer.costMinor <= 0n) unavailable = "No cost";
    else if (!landed) unavailable = `No exchange rate for ${offer.currency}`;
    return { offer, landed, leadTimeDays, unavailable };
  });

  const cheaper = (a: RankedOffer<O>, b: RankedOffer<O>) => (a.landed!.amountMinor < b.landed!.amountMinor ? -1 : a.landed!.amountMinor > b.landed!.amountMinor ? 1 : 0);
  const faster = (a: RankedOffer<O>, b: RankedOffer<O>) => a.leadTimeDays - b.leadTimeDays;
  // Out of stock (they said 0) only when nobody has it.
  const stocked = (a: RankedOffer<O>, b: RankedOffer<O>) => Number(a.offer.stock === 0) - Number(b.offer.stock === 0);
  const byRule: Record<SourcingRule, (a: RankedOffer<O>, b: RankedOffer<O>) => number> = {
    CHEAPEST_LANDED: (a, b) => stocked(a, b) || cheaper(a, b) || faster(a, b),
    FASTEST: (a, b) => stocked(a, b) || faster(a, b) || cheaper(a, b),
    PREFERRED: (a, b) => Number(b.offer.supplier.preferred) - Number(a.offer.supplier.preferred) || stocked(a, b) || cheaper(a, b) || faster(a, b),
  };
  const usable = ranked.filter((r) => !r.unavailable).sort((a, b) => byRule[rule](a, b) || a.offer.supplier.name.localeCompare(b.offer.supplier.name));
  const rest = ranked.filter((r) => r.unavailable);
  return { rule, chosen: usable[0] ?? null, ranked: [...usable, ...rest] };
}
