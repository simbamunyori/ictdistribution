import type { Market, PrismaClient } from "@prisma/client";
import { cache } from "react";
import { z } from "zod";
import { isCountryCode } from "@/lib/countries";
import { isSupportedCurrency } from "@/lib/money";
import { audit, staffAudit } from "@/server/audit";
import { DomainError } from "@/server/errors";
import { assertStaffCan, type StaffActor } from "@/server/staff/access";

/**
 * Markets: the countries we sell in, each with its currency and the rules
 * for converting our prices. Botswana, South Africa and Zimbabwe are
 * seeded; staff add more at /admin/markets, and every change is logged.
 */

export async function listMarkets(db: Pick<PrismaClient, "market">) {
  return db.market.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
}

/** Markets read once per request. */
export const cachedMarkets = cache(async (db: Pick<PrismaClient, "market">) => listMarkets(db));

export async function getMarket(db: Pick<PrismaClient, "market">, code: string) {
  const m = await db.market.findUnique({ where: { code } });
  if (!m) throw new DomainError("not-found", "No such market.");
  return m;
}

// ─── Editing ─────────────────────────────────────────────────────────

const optionalEmail = z
  .string()
  .trim()
  .max(254)
  .transform((v) => (v === "" ? null : v.toLowerCase()))
  .refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Enter a valid email address, or leave it empty.");

const intIn = (min: number, max: number, message: string) =>
  z.coerce
    .number({ message })
    .int(message)
    .min(min, message)
    .max(max, message);

export const marketSchema = z.object({
  name: z.string().trim().min(2, "Enter the country's name.").max(60, "Keep it under 60 characters."),
  currency: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .refine((v) => /^[A-Z]{3}$/.test(v), "Choose a currency."),
  locale: z
    .string()
    .trim()
    .min(2, "Enter a locale, like en-BW.")
    .refine((v) => {
      try {
        return Intl.NumberFormat.supportedLocalesOf([v]).length === 1;
      } catch {
        return false;
      }
    }, "That locale isn't one we can format for. Try en-BW, en-ZA or en-ZW."),
  timeZone: z
    .string()
    .trim()
    .refine((v) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }, "Enter a time zone, like Africa/Gaborone."),
  /** Entered as a percentage, e.g. "2" or "2.5". */
  fxBufferPercent: z.coerce.number({ message: "Enter a percentage from 0 to 20." }).min(0, "Enter a percentage from 0 to 20.").max(20, "Enter a percentage from 0 to 20."),
  roundToMinor: intIn(0, 1_000_000, "Enter a whole number of minor units, 0 for none."),
  supportEmail: optionalEmail,
  sortOrder: intIn(0, 1000, "Enter a whole number from 0 to 1000."),
  enabled: z.boolean(),
  isDefault: z.boolean(),
});

export type MarketInput = z.input<typeof marketSchema>;

function parse(input: MarketInput) {
  const parsed = marketSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    throw new DomainError("invalid", "Check the highlighted fields.", undefined, fieldErrors);
  }
  const { fxBufferPercent, ...rest } = parsed.data;
  return { ...rest, fxBufferBps: Math.round(fxBufferPercent * 100) };
}

async function assertCurrency(db: Pick<PrismaClient, "currency">, code: string) {
  const c = await db.currency.findUnique({ where: { code } });
  if (!c || !c.enabled) throw new DomainError("invalid", "Add that currency first, or switch it on.", "currency");
}

/** Keeps exactly one default, and the default switched on. */
function checkDefault(next: { enabled: boolean; isDefault: boolean }, othersDefault: number) {
  if (next.isDefault && !next.enabled) throw new DomainError("invalid", "The default market must be switched on.", "isDefault");
  if (!next.isDefault && othersDefault === 0) throw new DomainError("invalid", "Another market must be the default first.", "isDefault");
}

const FIELDS = ["name", "currency", "locale", "timeZone", "fxBufferBps", "roundToMinor", "supportEmail", "sortOrder", "enabled", "isDefault"] as const;

export async function updateMarket(db: PrismaClient, actor: StaffActor, code: string, input: MarketInput, ip?: string | null): Promise<Market> {
  assertStaffCan(actor, "manageMarkets");
  const data = parse(input);
  return db.$transaction(async (tx) => {
    const before = await tx.market.findUnique({ where: { code } });
    if (!before) throw new DomainError("not-found", "No such market.");
    await assertCurrency(tx, data.currency);
    checkDefault(data, await tx.market.count({ where: { isDefault: true, code: { not: code } } }));
    if (data.isDefault) await tx.market.updateMany({ where: { code: { not: code } }, data: { isDefault: false } });
    const after = await tx.market.update({ where: { code }, data });
    const changed = FIELDS.filter((f) => before[f] !== after[f]);
    if (changed.length) {
      await audit(
        tx,
        staffAudit(actor, {
          action: "market.updated",
          summary: `Changed ${after.name}: ${changed.join(", ")}`,
          targetType: "Market",
          targetId: code,
          data: Object.fromEntries(changed.map((f) => [f, { from: before[f], to: after[f] }])),
          ipAddress: ip,
        }),
      );
    }
    return after;
  });
}

export async function createMarket(db: PrismaClient, actor: StaffActor, countryInput: string, input: MarketInput, ip?: string | null): Promise<Market> {
  assertStaffCan(actor, "manageMarkets");
  const country = countryInput.trim().toUpperCase();
  if (!isCountryCode(country)) throw new DomainError("invalid", "Choose a country.", "country");
  const data = parse(input);
  const code = country.toLowerCase();
  return db.$transaction(async (tx) => {
    if (await tx.market.findUnique({ where: { country } })) throw new DomainError("conflict", "That country is already a market.", "country");
    await assertCurrency(tx, data.currency);
    if (data.isDefault) {
      checkDefault(data, 1);
      await tx.market.updateMany({ data: { isDefault: false } });
    }
    const market = await tx.market.create({ data: { code, country, ...data } });
    await audit(tx, staffAudit(actor, { action: "market.created", summary: `Added the market ${market.name} (${market.currency})`, targetType: "Market", targetId: code, ipAddress: ip }));
    return market;
  });
}

// ─── Currencies ──────────────────────────────────────────────────────

export async function listCurrencies(db: Pick<PrismaClient, "currency">) {
  return db.currency.findMany({ orderBy: { code: "asc" } });
}

/** Adds a currency we can price in. Rates for it are fetched with the next run. */
export async function addCurrency(db: PrismaClient, actor: StaffActor, codeInput: string, nameInput: string, ip?: string | null) {
  assertStaffCan(actor, "manageMarkets");
  const code = codeInput.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code) || !isSupportedCurrency(code)) throw new DomainError("invalid", "Enter a three-letter ISO currency code, like NAD.", "code");
  const name = nameInput.trim() || (new Intl.DisplayNames(["en"], { type: "currency" }).of(code) ?? code);
  return db.$transaction(async (tx) => {
    if (await tx.currency.findUnique({ where: { code } })) throw new DomainError("conflict", "That currency is already here.", "code");
    const currency = await tx.currency.create({ data: { code, name } });
    await audit(tx, staffAudit(actor, { action: "currency.created", summary: `Added the currency ${code} (${name})`, targetType: "Currency", targetId: code, ipAddress: ip }));
    return currency;
  });
}

export async function setCurrencyEnabled(db: PrismaClient, actor: StaffActor, code: string, enabled: boolean, ip?: string | null) {
  assertStaffCan(actor, "manageMarkets");
  return db.$transaction(async (tx) => {
    const settings = await tx.pricingSettings.findUnique({ where: { id: "global" } });
    if (!enabled && settings?.baseCurrency === code) throw new DomainError("invalid", "That is the base currency our prices are kept in.");
    if (!enabled && (await tx.market.count({ where: { currency: code, enabled: true } }))) throw new DomainError("invalid", "A market that is switched on uses it. Change that market first.");
    await tx.currency.update({ where: { code }, data: { enabled } });
    await audit(tx, staffAudit(actor, { action: enabled ? "currency.enabled" : "currency.disabled", summary: `${enabled ? "Switched on" : "Switched off"} ${code}`, targetType: "Currency", targetId: code, ipAddress: ip }));
  });
}
