import type { ShipMode } from "@prisma/client";
import { applyBps } from "./money";

/**
 * Freight, insurance, duty and clearing estimates. Pure: the caller loads
 * the shipment history, the overrides, the duty rules and the settings,
 * all of which are set in the admin area. Amounts are minor units of the
 * base currency.
 */

export const SHIP_MODE_LABEL: Record<ShipMode, string> = { AIR: "Air", SEA: "Sea", ROAD: "Road", COURIER: "Courier" };

export interface VolumetricFactors {
  airKgPerM3: number;
  courierKgPerM3: number;
  roadKgPerM3: number;
  seaKgPerM3: number;
}

export function kgPerM3(mode: ShipMode, f: VolumetricFactors): number {
  return { AIR: f.airKgPerM3, COURIER: f.courierKgPerM3, ROAD: f.roadKgPerM3, SEA: f.seaKgPerM3 }[mode];
}

/** The weight that is charged: the actual weight or the volumetric weight, whichever is more. In grams. */
export function chargeableGrams(weightGrams: number, volumeCm3: number, kgM3: number): number {
  // cm3 / 1,000,000 = m3; m3 x kg/m3 x 1,000 = grams.
  const volumetric = Math.ceil((volumeCm3 * kgM3) / 1000);
  return Math.max(weightGrams, volumetric);
}

/** A boxed unit's volume from its sides in millimetres; null when any side is missing. */
export function boxCm3(lengthMm: number | null, widthMm: number | null, heightMm: number | null): number | null {
  if (!lengthMm || !widthMm || !heightMm) return null;
  return Math.ceil((lengthMm * widthMm * heightMm) / 1000);
}

function median(values: bigint[]): bigint | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2n;
}

/** One past shipment, its costs already in the base currency. */
export interface ShipmentSample {
  chargeableGrams: number;
  freight: bigint;
  /** Clearing and other fees. */
  fees: bigint;
  insurance: bigint;
  goodsValue: bigint | null;
  transitDays: number | null;
}

export interface RouteEstimate {
  /** Freight per chargeable kilogram. */
  perKg: bigint;
  /** Clearing and other fees per chargeable kilogram. */
  feesPerKg: bigint;
  /** Insurance as basis points of the goods value; null uses the default. */
  insuranceBps: number | null;
  transitDays: number | null;
  /** How many shipments it is from. 0 when staff set it. */
  samples: number;
  overridden: boolean;
}

/**
 * The typical cost per chargeable kilogram on a route and mode: the
 * median over the shipments given, so one odd shipment doesn't move it.
 */
export function estimateRoute(samples: ShipmentSample[]): RouteEstimate | null {
  const usable = samples.filter((s) => s.chargeableGrams > 0 && s.freight > 0n);
  if (!usable.length) return null;
  const perKg = median(usable.map((s) => (s.freight * 1000n) / BigInt(s.chargeableGrams)))!;
  const feesPerKg = median(usable.map((s) => (s.fees * 1000n) / BigInt(s.chargeableGrams)))!;
  const insured = usable.filter((s) => s.goodsValue && s.goodsValue > 0n && s.insurance > 0n);
  const insuranceBps = insured.length ? Number(median(insured.map((s) => (s.insurance * 10_000n) / s.goodsValue!))) : null;
  const days = usable.map((s) => s.transitDays).filter((d): d is number => d !== null && d >= 0);
  const transitDays = days.length ? Number(median(days.map(BigInt))) : null;
  return { perKg, feesPerKg, insuranceBps, transitDays, samples: usable.length, overridden: false };
}

/** Staff's own figures win over the history, field by field. */
export function applyOverride(est: RouteEstimate | null, o: { perKgMinor: bigint | null; feesPerKgMinor: bigint | null; transitDays: number | null } | null): RouteEstimate | null {
  if (!o) return est;
  const perKg = o.perKgMinor ?? est?.perKg ?? null;
  if (perKg === null) return null;
  return { perKg, feesPerKg: o.feesPerKgMinor ?? est?.feesPerKg ?? 0n, insuranceBps: est?.insuranceBps ?? null, transitDays: o.transitDays ?? est?.transitDays ?? null, samples: est?.samples ?? 0, overridden: true };
}

export interface DutyRuleForChoice {
  categoryId: string | null;
  destinationCountry: string;
  dutyBps: number;
  leviesBps: number;
  exemptOrigins: string[];
}

/** The rule for a category landed in a country: its own, else its parent's, else the one for every category. */
export function dutyFor(rules: DutyRuleForChoice[], categoryIds: (string | null | undefined)[], destination: string, origin: string): { dutyBps: number; leviesBps: number; exempt: boolean } {
  const here = rules.filter((r) => r.destinationCountry === destination);
  for (const id of [...categoryIds.filter((c): c is string => Boolean(c)), null]) {
    const r = here.find((x) => x.categoryId === id);
    if (r) {
      const exempt = r.exemptOrigins.includes(origin);
      return { dutyBps: exempt ? 0 : r.dutyBps, leviesBps: exempt ? 0 : r.leviesBps, exempt };
    }
  }
  return { dutyBps: 0, leviesBps: 0, exempt: false };
}

export interface LandedParts {
  freight: bigint;
  insurance: bigint;
  duty: bigint;
  fees: bigint;
  /** Everything added to the cost. */
  total: bigint;
}

/**
 * What lands one unit in our warehouse on top of its cost: freight and
 * fees by chargeable weight, insurance on the value, and duty and levies
 * on the customs value (cost, insurance and freight).
 */
export function landedParts(costBase: bigint, unitChargeableGrams: number, route: RouteEstimate, defaultInsuranceBps: number, duty: { dutyBps: number; leviesBps: number }): LandedParts {
  const grams = BigInt(unitChargeableGrams);
  const freight = (route.perKg * grams + 999n) / 1000n;
  const fees = (route.feesPerKg * grams + 999n) / 1000n;
  const insurance = applyBps(costBase, route.insuranceBps ?? defaultInsuranceBps);
  const duty_ = applyBps(costBase + freight + insurance, duty.dutyBps + duty.leviesBps);
  return { freight, insurance, duty: duty_, fees, total: freight + insurance + duty_ + fees };
}

/** Days from one date to another, whole days, never negative. */
export function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86_400_000));
}

export const TRACKING_ORDER = ["ORDERED", "SHIPPED", "IN_TRANSIT", "AT_CUSTOMS", "CLEARED", "IN_WAREHOUSE", "OUT_FOR_DELIVERY", "DELIVERED"] as const;
export type Tracking = (typeof TRACKING_ORDER)[number];

export const TRACKING_LABEL: Record<Tracking, string> = {
  ORDERED: "Ordered",
  SHIPPED: "Shipped by the supplier",
  IN_TRANSIT: "In transit",
  AT_CUSTOMS: "At customs",
  CLEARED: "Cleared customs",
  IN_WAREHOUSE: "In our warehouse",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
};

/** Whether moving from one step to another goes forward. Automatic updates only go forward; staff can set any step. */
export function isForward(from: Tracking | null, to: Tracking): boolean {
  return from === null || TRACKING_ORDER.indexOf(to) > TRACKING_ORDER.indexOf(from);
}
