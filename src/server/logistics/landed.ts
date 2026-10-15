import type { Prisma, PrismaClient, ShipMode } from "@prisma/client";
import { applyOverride, boxCm3, chargeableGrams, daysBetween, dutyFor, estimateRoute, kgPerM3, landedParts, type DutyRuleForChoice, type LandedParts, type RouteEstimate, type ShipmentSample } from "@/lib/freight";
import { toBase } from "@/lib/pricing";
import type { LandedAdd, OfferForChoice } from "@/lib/sourcing";
import { asRate, currentRates, pricingSettings } from "@/server/pricing/rates";

/**
 * Landed cost from our own shipment history: freight and fees per
 * chargeable kilogram on each route and mode, insurance, and duty by
 * category for where goods land. Loaded once and used for many products.
 */

type Db = Pick<PrismaClient, "logisticsSettings" | "warehouse" | "shipment" | "freightOverride" | "dutyRule" | "pricingSettings" | "exchangeRate">;

export async function logisticsSettings(db: Pick<PrismaClient, "logisticsSettings"> | Prisma.TransactionClient) {
  return db.logisticsSettings.upsert({ where: { id: "global" }, update: {}, create: { id: "global" } });
}

/** Where goods land for duty: the default warehouse's country, else the setting. */
export async function homeCountry(db: Pick<PrismaClient, "logisticsSettings" | "warehouse">) {
  const s = await logisticsSettings(db);
  const w = s.defaultWarehouseId ? await db.warehouse.findUnique({ where: { id: s.defaultWarehouseId }, select: { country: true } }) : null;
  return w?.country ?? s.homeCountry;
}

const routeKey = (origin: string, mode: ShipMode) => `${origin}:${mode}`;

export interface LandedContext {
  base: string;
  home: string;
  settings: Awaited<ReturnType<typeof logisticsSettings>>;
  routes: Map<string, RouteEstimate>;
  duties: DutyRuleForChoice[];
}

/** The estimates for every route into our home country, from the arrived shipments and staff overrides. */
export async function landedContext(db: Db): Promise<LandedContext> {
  const [settings, pricing, home] = await Promise.all([logisticsSettings(db), pricingSettings(db), homeCountry(db)]);
  const base = pricing.baseCurrency;
  const rates = await currentRates(db, base);
  const shipments = await db.shipment.findMany({
    where: { destinationCountry: home, OR: [{ source: "HISTORY" }, { status: "ARRIVED" }], freightMinor: { gt: 0n }, weightGrams: { gt: 0 } },
    orderBy: [{ arrivedOn: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take: 2000,
  });
  const samples = new Map<string, ShipmentSample[]>();
  for (const sh of shipments) {
    const key = routeKey(sh.originCountry, sh.mode);
    const list = samples.get(key) ?? [];
    if (list.length >= settings.sampleSize) continue;
    const rate = sh.currency === base ? null : asRate(rates.get(sh.currency));
    if (sh.currency !== base && !rate) continue;
    const b = (n: bigint) => toBase({ amountMinor: n, currency: sh.currency }, base, rate).amountMinor;
    list.push({
      chargeableGrams: chargeableGrams(sh.weightGrams, sh.volumeCm3, kgPerM3(sh.mode, settings)),
      freight: b(sh.freightMinor),
      fees: b(sh.clearingMinor + sh.otherMinor),
      insurance: b(sh.insuranceMinor),
      goodsValue: sh.goodsValueMinor === null ? null : b(sh.goodsValueMinor),
      transitDays: sh.transitDays ?? (sh.shippedOn && sh.arrivedOn ? daysBetween(sh.shippedOn, sh.arrivedOn) : null),
    });
    samples.set(key, list);
  }
  const routes = new Map<string, RouteEstimate>();
  for (const [key, list] of samples) {
    const est = estimateRoute(list);
    if (est) routes.set(key, est);
  }
  for (const o of await db.freightOverride.findMany({ where: { destinationCountry: home } })) {
    const key = routeKey(o.originCountry, o.mode);
    const est = applyOverride(routes.get(key) ?? null, o);
    if (est) routes.set(key, est);
    else routes.delete(key);
  }
  const duties = await db.dutyRule.findMany({ where: { destinationCountry: home } });
  return { base, home, settings, routes, duties };
}

export function routeEstimate(ctx: LandedContext, origin: string, mode: ShipMode) {
  return ctx.routes.get(routeKey(origin, mode)) ?? null;
}

export interface ProductForLanded {
  weightGrams: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  categoryId: string;
  parentCategoryId: string | null;
}

type SupplierRoute = { country?: string; freightMode?: ShipMode };

/** One unit's freight, insurance, duty and fees from a supplier, or null when they can't be estimated. */
export function unitLanded(ctx: LandedContext, product: ProductForLanded, supplier: SupplierRoute, costBase: bigint): (LandedParts & { route: RouteEstimate; chargeableGrams: number; dutyExempt: boolean }) | null {
  if (!product.weightGrams || !supplier.country || !supplier.freightMode) return null;
  const route = routeEstimate(ctx, supplier.country, supplier.freightMode);
  if (!route) return null;
  const grams = chargeableGrams(product.weightGrams, boxCm3(product.lengthMm, product.widthMm, product.heightMm) ?? 0, kgPerM3(supplier.freightMode, ctx.settings));
  // Goods already in the home country pay no import duty.
  const duty = supplier.country === ctx.home ? { dutyBps: 0, leviesBps: 0, exempt: true } : dutyFor(ctx.duties, [product.categoryId, product.parentCategoryId], ctx.home, supplier.country);
  return { ...landedParts(costBase, grams, route, ctx.settings.insuranceBps, duty), route, chargeableGrams: grams, dutyExempt: duty.exempt };
}

/** For chooseOffer: what each offer adds to land one unit of this product. */
export function landedAdder<O extends OfferForChoice>(ctx: LandedContext, product: ProductForLanded): LandedAdd<O> {
  return (offer, costBase) => unitLanded(ctx, product, offer.supplier as SupplierRoute, costBase)?.total ?? null;
}
