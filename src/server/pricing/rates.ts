import type { ExchangeRate, PrismaClient } from "@prisma/client";
import { movedBps, parseRate, rateText, type Rate } from "@/lib/pricing";
import { audit, staffAudit, SYSTEM_ACTOR } from "@/server/audit";
import { DomainError } from "@/server/errors";
import { assertStaffCan, type StaffActor } from "@/server/staff/access";

/**
 * Exchange rates, fetched automatically from the base currency (USD) to
 * every currency we have switched on. A rate that jumps more than the
 * hold threshold (/admin/exchange-rates) is kept but not used until an
 * Admin or Finance accepts it; the rate before it stays in use meanwhile.
 */

export interface FetchedRates {
  /** When the source published these rates. */
  publishedAt: Date;
  /** 1 base = value quote. */
  rates: Record<string, number>;
  source: string;
}

/** Anything that can tell us today's rates. */
export interface RateSource {
  latest(base: string): Promise<FetchedRates>;
}

/**
 * ExchangeRate-API's open access endpoint: free, no key, updated daily,
 * covers BWP, ZAR and USD. Its terms ask for a link to them where the
 * rates are shown, which /admin/exchange-rates carries.
 */
export class OpenErApiSource implements RateSource {
  constructor(private fetchImpl: typeof fetch = fetch) {}
  async latest(base: string): Promise<FetchedRates> {
    const res = await this.fetchImpl(`https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`, { signal: AbortSignal.timeout(15_000), headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`The rate source answered ${res.status}.`);
    const body = (await res.json()) as { result?: string; base_code?: string; time_last_update_unix?: number; rates?: Record<string, number> };
    if (body.result !== "success" || body.base_code !== base || !body.rates || !body.time_last_update_unix) throw new Error("The rate source sent something we couldn't read.");
    return { publishedAt: new Date(body.time_last_update_unix * 1000), rates: body.rates, source: "open.er-api.com" };
  }
}

export async function pricingSettings(db: Pick<PrismaClient, "pricingSettings">) {
  return db.pricingSettings.upsert({ where: { id: "global" }, create: { id: "global" }, update: {} });
}

/** The rate in use for a pair: the newest one that isn't held back. */
export async function currentRate(db: Pick<PrismaClient, "exchangeRate">, base: string, quote: string): Promise<ExchangeRate | null> {
  return db.exchangeRate.findFirst({ where: { base, quote, heldBack: null }, orderBy: { fetchedAt: "desc" } });
}

/** Every rate in use from the base currency, by quote currency. */
export async function currentRates(db: Pick<PrismaClient, "exchangeRate">, base: string): Promise<Map<string, ExchangeRate>> {
  const rows = await db.exchangeRate.findMany({ where: { base, heldBack: null }, orderBy: { fetchedAt: "desc" } });
  const map = new Map<string, ExchangeRate>();
  for (const r of rows) if (!map.has(r.quote)) map.set(r.quote, r);
  return map;
}

export const asRate = (row: Pick<ExchangeRate, "rate"> | null | undefined): Rate | null => (row ? parseRate(row.rate) : null);

export interface RefreshResult {
  stored: string[];
  held: string[];
  unchanged: string[];
}

/** Fetches, checks and stores the rates. Throws, after recording why, when the source fails or sends bad data. */
export async function refreshRates(db: PrismaClient, source: RateSource, now = new Date()): Promise<RefreshResult> {
  const settings = await pricingSettings(db);
  const base = settings.baseCurrency;
  const quotes = (await db.currency.findMany({ where: { enabled: true, code: { not: base } }, select: { code: true } })).map((c) => c.code);
  try {
    const fetched = await source.latest(base);
    if (fetched.publishedAt.getTime() > now.getTime() + 60 * 60_000) throw new Error("The rates are dated in the future.");
    const missing = quotes.filter((q) => !(typeof fetched.rates[q] === "number" && fetched.rates[q] > 0));
    if (missing.length) throw new Error(`The rates have no usable value for ${missing.join(", ")}.`);

    const result: RefreshResult = { stored: [], held: [], unchanged: [] };
    const inUse = await currentRates(db, base);
    for (const quote of quotes) {
      const text = rateText(fetched.rates[quote]);
      const before = inUse.get(quote);
      if (before && before.rate === text && before.publishedAt.getTime() === fetched.publishedAt.getTime()) {
        result.unchanged.push(quote);
        continue;
      }
      const moved = before ? movedBps(parseRate(before.rate), parseRate(text)) : 0;
      const heldBack = before && moved > settings.rateJumpHoldBps ? `Moved ${(moved / 100).toFixed(2)}% since the rate in use (${before.rate}).` : null;
      await db.$transaction(async (tx) => {
        await tx.exchangeRate.create({ data: { base, quote, rate: text, source: fetched.source, publishedAt: fetched.publishedAt, fetchedAt: now, heldBack } });
        if (heldBack) {
          await audit(tx, { ...SYSTEM_ACTOR, action: "rate.held", summary: `Held back ${base} to ${quote} at ${text}: ${heldBack}`, targetType: "ExchangeRate", targetId: `${base}/${quote}` });
        }
      });
      (heldBack ? result.held : result.stored).push(quote);
    }
    await db.pricingSettings.update({ where: { id: "global" }, data: { ratesCheckedAt: now, ratesError: null } });
    return result;
  } catch (e) {
    const message = e instanceof Error ? e.message.slice(0, 300) : "Unknown error";
    await db.pricingSettings.update({ where: { id: "global" }, data: { ratesCheckedAt: now, ratesError: message } });
    throw e;
  }
}

/** An Admin or Finance accepts a held-back rate: it becomes the one in use. */
export async function acceptRate(db: PrismaClient, actor: StaffActor, id: string, ip?: string | null, now = new Date()) {
  assertStaffCan(actor, "manageRates");
  await db.$transaction(async (tx) => {
    const row = await tx.exchangeRate.findUnique({ where: { id } });
    if (!row || !row.heldBack) throw new DomainError("not-found", "That rate isn't waiting to be accepted.");
    // It counts from now, so it is newer than anything stored while it waited.
    await tx.exchangeRate.update({ where: { id }, data: { heldBack: null, acceptedById: actor.userId, acceptedAt: now, fetchedAt: now } });
    await audit(tx, staffAudit(actor, { action: "rate.accepted", summary: `Accepted ${row.base} to ${row.quote} at ${row.rate}`, targetType: "ExchangeRate", targetId: id, ipAddress: ip }));
  });
  await refreshProductCosts(db);
}

/** Landed costs follow the rates in use. Loaded late: costs.ts reads rates too. */
async function refreshProductCosts(db: PrismaClient) {
  const { refreshCosts } = await import("@/server/shop/costs");
  await refreshCosts(db);
}

/** A rate typed by staff, for when the source is off or wrong. Used at once. */
export async function setRate(db: PrismaClient, actor: StaffActor, quoteInput: string, rateInput: string, ip?: string | null, now = new Date()) {
  assertStaffCan(actor, "manageRates");
  const quote = quoteInput.trim().toUpperCase();
  const text = rateInput.trim().replace(/,/g, "");
  try {
    parseRate(text);
  } catch {
    throw new DomainError("invalid", "Enter the rate as a number, like 13.6512.", "rate");
  }
  const { baseCurrency: base } = await pricingSettings(db);
  if (quote === base || !(await db.currency.findFirst({ where: { code: quote, enabled: true } }))) throw new DomainError("invalid", "Choose a currency that is switched on.", "quote");
  await db.$transaction(async (tx) => {
    await tx.exchangeRate.create({ data: { base, quote, rate: text, source: "staff", publishedAt: now, fetchedAt: now, acceptedById: actor.userId, acceptedAt: now } });
    await audit(tx, staffAudit(actor, { action: "rate.set", summary: `Set ${base} to ${quote} at ${text} by hand`, targetType: "ExchangeRate", targetId: `${base}/${quote}`, ipAddress: ip }));
  });
  await refreshProductCosts(db);
}

export async function updateRateRules(db: PrismaClient, actor: StaffActor, input: { holdPercent: number; maxAgeHours: number }, ip?: string | null) {
  assertStaffCan(actor, "manageRates");
  if (!Number.isFinite(input.holdPercent) || input.holdPercent < 0.5 || input.holdPercent > 50) throw new DomainError("invalid", "Enter a percentage from 0.5 to 50.", "holdPercent");
  if (!Number.isInteger(input.maxAgeHours) || input.maxAgeHours < 1 || input.maxAgeHours > 720) throw new DomainError("invalid", "Enter a whole number of hours from 1 to 720.", "maxAgeHours");
  const rateJumpHoldBps = Math.round(input.holdPercent * 100);
  await db.$transaction(async (tx) => {
    const before = await pricingSettings(tx as PrismaClient);
    await tx.pricingSettings.update({ where: { id: "global" }, data: { rateJumpHoldBps, rateMaxAgeHours: input.maxAgeHours } });
    await audit(
      tx,
      staffAudit(actor, {
        action: "rate.rules-updated",
        summary: `Rates now held back above ${(rateJumpHoldBps / 100).toFixed(2)}% and flagged after ${input.maxAgeHours} hours`,
        data: { from: { rateJumpHoldBps: before.rateJumpHoldBps, rateMaxAgeHours: before.rateMaxAgeHours }, to: { rateJumpHoldBps, rateMaxAgeHours: input.maxAgeHours } },
        ipAddress: ip,
      }),
    );
  });
}

/** What staff should know about the rates: missing, stale, held back or failing. Empty when all is well. */
export async function rateWarnings(db: PrismaClient, now = new Date()): Promise<string[]> {
  const settings = await pricingSettings(db);
  const base = settings.baseCurrency;
  const needed = await db.market.findMany({ where: { enabled: true, currency: { not: base } }, select: { name: true, currency: true } });
  const inUse = await currentRates(db, base);
  const warnings: string[] = [];
  for (const m of needed) {
    const r = inUse.get(m.currency);
    if (!r) warnings.push(`${m.name} has no ${base} to ${m.currency} rate yet, so it can't show prices.`);
    else if (now.getTime() - r.fetchedAt.getTime() > settings.rateMaxAgeHours * 3_600_000) warnings.push(`The ${base} to ${m.currency} rate is more than ${settings.rateMaxAgeHours} hours old.`);
  }
  const held = await db.exchangeRate.count({ where: { heldBack: { not: null } } });
  if (held) warnings.push(`${held} ${held === 1 ? "rate is" : "rates are"} held back, waiting to be accepted.`);
  if (settings.ratesError) warnings.push(`The last rate fetch failed: ${settings.ratesError}`);
  return warnings;
}
