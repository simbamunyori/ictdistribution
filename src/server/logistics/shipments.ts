import type { LineTracking, Prisma, PrismaClient, ShipMode, ShipmentSource, ShipmentStatus } from "@prisma/client";
import { company } from "@/config/app";
import { isCountryCode } from "@/lib/countries";
import { applyBps, formatMoney, isSupportedCurrency, parseMoney, toPlainAmount } from "@/lib/money";
import { chargeableGrams, daysBetween, kgPerM3, SHIP_MODE_LABEL } from "@/lib/freight";
import { parseCsv } from "@/lib/price-list";
import { audit, staffAudit } from "@/server/audit";
import { DomainError } from "@/server/errors";
import { WITH_SUPPLIER } from "@/server/procurement/common";
import { receivePo } from "@/server/procurement/purchase-orders";
import { refreshCosts } from "@/server/shop/costs";
import { assertStaffCan, type StaffActor } from "@/server/staff/access";
import { homeCountry, landedContext, routeEstimate } from "./landed";
import { advanceLines, poLineIds } from "./tracking";

/**
 * Shipments: every consignment we bring in, past and present, with what it
 * weighed and cost. Past ones are loaded as history; live ones carry our
 * purchase orders and move their lines along as they travel. Arrived
 * shipments are what freight is estimated from.
 */

type Tx = Prisma.TransactionClient;

export const SHIP_MODES: ShipMode[] = ["AIR", "SEA", "ROAD", "COURIER"];

export const SHIPMENT_STATUS_LABEL: Record<ShipmentStatus, string> = { BOOKED: "Booked", IN_TRANSIT: "In transit", AT_CUSTOMS: "At customs", CLEARED: "Cleared customs", ARRIVED: "Arrived" };
export const SHIPMENT_STATUS_TONE = { BOOKED: "neutral", IN_TRANSIT: "highlight", AT_CUSTOMS: "warning", CLEARED: "highlight", ARRIVED: "positive" } as const;
export const SHIPMENT_STATUSES = Object.keys(SHIPMENT_STATUS_LABEL) as ShipmentStatus[];

/** What a shipment's step means for the order lines in it. */
const LINE_STEP: Partial<Record<ShipmentStatus, LineTracking>> = { IN_TRANSIT: "IN_TRANSIT", AT_CUSTOMS: "AT_CUSTOMS", CLEARED: "CLEARED" };

export interface ShipmentInput {
  mode: string;
  originCountry: string;
  destinationCountry: string;
  carrier: string;
  reference: string;
  /** Kilograms, up to 3 decimals. */
  weightKg: string;
  /** Cubic metres, up to 3 decimals. Optional. */
  volumeM3: string;
  currency: string;
  goodsValue: string;
  freight: string;
  insurance: string;
  duties: string;
  clearing: string;
  other: string;
  /** yyyy-mm-dd */
  shippedOn: string;
  arrivedOn: string;
  transitDays: string;
  notes: string;
}

export const EMPTY_SHIPMENT: ShipmentInput = { mode: "ROAD", originCountry: "", destinationCountry: "", carrier: "", reference: "", weightKg: "", volumeM3: "", currency: "", goodsValue: "", freight: "", insurance: "", duties: "", clearing: "", other: "", shippedOn: "", arrivedOn: "", transitDays: "", notes: "" };

const MONEY_FIELDS = ["goodsValue", "freight", "insurance", "duties", "clearing", "other"] as const;

function decimal(text: string, max: number): number | null {
  const t = text.trim().replace(/,/g, "");
  if (!t) return null;
  if (!/^\d+(\.\d{1,3})?$/.test(t)) return NaN;
  const n = Number(t);
  return n > max ? NaN : n;
}

function date(text: string): Date | null | undefined {
  const t = text.trim();
  if (!t) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return undefined;
  const d = new Date(`${t}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Checks a shipment and turns it into what is stored. Throws with every problem found. */
export function readShipment(input: ShipmentInput, now: Date, prefix = "") {
  const errors: Record<string, string> = {};
  const err = (field: string, msg: string) => (errors[`${prefix}${field}`] = msg);
  const mode = input.mode.trim().toUpperCase() as ShipMode;
  if (!SHIP_MODES.includes(mode)) err("mode", "Choose air, sea, road or courier.");
  const originCountry = input.originCountry.trim().toUpperCase();
  const destinationCountry = input.destinationCountry.trim().toUpperCase();
  if (!isCountryCode(originCountry)) err("originCountry", "Enter the two-letter country code it came from, such as ZA.");
  if (!isCountryCode(destinationCountry)) err("destinationCountry", "Enter the two-letter country code it went to, such as BW.");
  const weightKg = decimal(input.weightKg, 1_000_000);
  if (weightKg === null || Number.isNaN(weightKg) || weightKg <= 0) err("weightKg", "Enter the weight in kilograms, such as 12.5.");
  const volumeM3 = decimal(input.volumeM3, 10_000);
  if (Number.isNaN(volumeM3)) err("volumeM3", "Enter the volume in cubic metres, such as 0.35, or leave it empty.");
  const currency = input.currency.trim().toUpperCase();
  if (!isSupportedCurrency(currency)) err("currency", "Enter the currency the costs were paid in, such as BWP.");
  const amounts: Partial<Record<(typeof MONEY_FIELDS)[number], bigint | null>> = {};
  for (const f of MONEY_FIELDS) {
    const t = input[f].trim();
    if (!t) {
      amounts[f] = f === "goodsValue" ? null : 0n;
      continue;
    }
    try {
      const v = parseMoney(t, isSupportedCurrency(currency) ? currency : "USD");
      if (v < 0n) throw new Error();
      amounts[f] = v;
    } catch {
      err(f, "Enter an amount, such as 1250.00.");
    }
  }
  const shippedOn = date(input.shippedOn);
  const arrivedOn = date(input.arrivedOn);
  if (shippedOn === undefined) err("shippedOn", "Enter a date.");
  if (arrivedOn === undefined) err("arrivedOn", "Enter a date.");
  if (shippedOn && shippedOn.getTime() > now.getTime() + 366 * 86_400_000) err("shippedOn", "Enter a date within a year.");
  if (shippedOn && arrivedOn && arrivedOn < shippedOn) err("arrivedOn", "It can't arrive before it shipped.");
  const transitText = input.transitDays.trim();
  const transit = transitText ? (/^\d{1,3}$/.test(transitText) ? Number(transitText) : NaN) : null;
  if (Number.isNaN(transit)) err("transitDays", "Enter whole days, up to 999.");
  const notes = input.notes.trim();
  if (notes.length > 1000) err("notes", "Keep it under 1000 characters.");
  if (Object.keys(errors).length) throw new DomainError("invalid", "Check the highlighted fields.", undefined, errors);
  return {
    mode,
    originCountry,
    destinationCountry,
    carrier: input.carrier.trim().slice(0, 80),
    reference: input.reference.trim().slice(0, 80),
    weightGrams: Math.round(weightKg! * 1000),
    volumeCm3: Math.round((volumeM3 ?? 0) * 1_000_000),
    currency,
    goodsValueMinor: amounts.goodsValue ?? null,
    freightMinor: amounts.freight ?? 0n,
    insuranceMinor: amounts.insurance ?? 0n,
    dutiesMinor: amounts.duties ?? 0n,
    clearingMinor: amounts.clearing ?? 0n,
    otherMinor: amounts.other ?? 0n,
    shippedOn: shippedOn ?? null,
    arrivedOn: arrivedOn ?? null,
    transitDays: transit ?? (shippedOn && arrivedOn ? daysBetween(shippedOn, arrivedOn) : null),
    notes,
  };
}

/** A stored shipment as the form shows it. */
export function shipmentFormValues(s: Prisma.ShipmentGetPayload<object>): ShipmentInput {
  const m = (n: bigint | null) => (n === null ? "" : toPlainAmount({ amountMinor: n, currency: s.currency }));
  const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
  return { mode: s.mode, originCountry: s.originCountry, destinationCountry: s.destinationCountry, carrier: s.carrier, reference: s.reference, weightKg: String(s.weightGrams / 1000), volumeM3: s.volumeCm3 ? String(s.volumeCm3 / 1_000_000) : "", currency: s.currency, goodsValue: m(s.goodsValueMinor), freight: m(s.freightMinor), insurance: m(s.insuranceMinor), duties: m(s.dutiesMinor), clearing: m(s.clearingMinor), other: m(s.otherMinor), shippedOn: ymd(s.shippedOn), arrivedOn: ymd(s.arrivedOn), transitDays: s.transitDays === null ? "" : String(s.transitDays), notes: s.notes };
}

async function nextNumber(tx: Tx) {
  const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('shipment_number_seq') AS n`;
  return `SH-${n}`;
}

const money = (n: bigint, currency: string) => formatMoney({ amountMinor: n, currency }, company.staffLocale);
const total = (s: { freightMinor: bigint; insuranceMinor: bigint; dutiesMinor: bigint; clearingMinor: bigint; otherMinor: bigint }) => s.freightMinor + s.insuranceMinor + s.dutiesMinor + s.clearingMinor + s.otherMinor;

/**
 * Records a shipment. A past one (history) counts as arrived and feeds the
 * estimates straight away; a live one starts booked and carries our
 * purchase orders.
 */
export async function recordShipment(db: PrismaClient, actor: StaffActor, source: ShipmentSource, input: ShipmentInput, ip?: string | null, now = new Date()) {
  assertStaffCan(actor, "manageShipments");
  const data = readShipment(input, now);
  const s = await db.$transaction(async (tx) => {
    const s = await tx.shipment.create({ data: { ...data, number: await nextNumber(tx), source, status: source === "HISTORY" ? "ARRIVED" : "BOOKED", createdByLabel: actor.name } });
    await audit(tx, staffAudit(actor, { action: "shipment.recorded", summary: `Recorded ${source === "HISTORY" ? "past " : ""}shipment ${s.number}, ${SHIP_MODE_LABEL[s.mode].toLowerCase()} from ${s.originCountry} to ${s.destinationCountry}, ${s.weightGrams / 1000} kg, ${money(total(s), s.currency)}`, targetType: "Shipment", targetId: s.id, ipAddress: ip }));
    return s;
  });
  if (source === "HISTORY") await refreshCosts(db);
  return s;
}

/** Corrects a shipment, such as when the final invoice for it arrives. */
export async function updateShipment(db: PrismaClient, actor: StaffActor, id: string, input: ShipmentInput, ip?: string | null, now = new Date()) {
  assertStaffCan(actor, "manageShipments");
  const data = readShipment(input, now);
  await db.$transaction(async (tx) => {
    const before = await tx.shipment.findUnique({ where: { id } });
    if (!before) throw new DomainError("not-found", "No such shipment.");
    const s = await tx.shipment.update({ where: { id }, data });
    await audit(tx, staffAudit(actor, { action: "shipment.updated", summary: `Changed shipment ${s.number}: ${s.weightGrams / 1000} kg, ${money(total(s), s.currency)}${total(before) !== total(s) || before.currency !== s.currency ? ` (was ${money(total(before), before.currency)})` : ""}`, targetType: "Shipment", targetId: id, ipAddress: ip }));
  });
  await refreshCosts(db);
}

/** Moves a live shipment along. Its order lines follow; on arrival its purchase orders are received. */
export async function setShipmentStatus(db: PrismaClient, actor: StaffActor, id: string, statusInput: string, ip?: string | null, now = new Date()) {
  assertStaffCan(actor, "manageShipments");
  if (!SHIPMENT_STATUSES.includes(statusInput as ShipmentStatus)) throw new DomainError("invalid", "Choose a step.", "status");
  const status = statusInput as ShipmentStatus;
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Shipment" WHERE id = ${id} FOR UPDATE`;
    const s = await tx.shipment.findUnique({ where: { id }, include: { purchaseOrders: { include: { lines: true } } } });
    if (!s) throw new DomainError("not-found", "No such shipment.");
    if (s.source === "HISTORY") throw new DomainError("conflict", "A past shipment has already arrived.");
    if (s.status === status) return;
    if (s.status === "ARRIVED") throw new DomainError("conflict", "This shipment has arrived and its goods were received.");
    await tx.shipment.update({ where: { id }, data: { status, ...(status === "IN_TRANSIT" && !s.shippedOn ? { shippedOn: now } : {}), ...(status === "ARRIVED" ? { arrivedOn: s.arrivedOn ?? now, transitDays: s.transitDays ?? (s.shippedOn ? daysBetween(s.shippedOn, now) : null) } : {}) } });
    const open = s.purchaseOrders.filter((po) => WITH_SUPPLIER.includes(po.status));
    const step = LINE_STEP[status];
    if (step) await advanceLines(tx, await poLineIds(tx, open.map((po) => po.id)), step, actor.name, `Shipment ${s.number}`, now);
    if (status === "ARRIVED") for (const po of open) await receivePo(tx, po, actor.name, now);
    await audit(tx, staffAudit(actor, { action: "shipment.status", summary: `Shipment ${s.number} is ${SHIPMENT_STATUS_LABEL[status].toLowerCase()}${status === "ARRIVED" && open.length ? `; received ${open.map((po) => po.number).join(", ")}` : ""}`, targetType: "Shipment", targetId: id, ipAddress: ip }));
  });
  if (status === "ARRIVED") await refreshCosts(db);
}

/** Puts purchase orders on a live shipment, by number. Their lines catch up with where the shipment is. */
export async function addPurchaseOrders(db: PrismaClient, actor: StaffActor, id: string, numbersInput: string, ip?: string | null, now = new Date()) {
  assertStaffCan(actor, "manageShipments");
  const numbers = [...new Set(numbersInput.split(/[\s,;]+/).map((n) => n.trim().toUpperCase()).filter(Boolean))];
  if (!numbers.length) throw new DomainError("invalid", "Enter one or more purchase order numbers.", "numbers");
  await db.$transaction(async (tx) => {
    const s = await tx.shipment.findUnique({ where: { id } });
    if (!s) throw new DomainError("not-found", "No such shipment.");
    if (s.source === "HISTORY" || s.status === "ARRIVED") throw new DomainError("conflict", "Only a shipment still on its way can take purchase orders.");
    const pos = await tx.purchaseOrder.findMany({ where: { number: { in: numbers } } });
    const missing = numbers.filter((n) => !pos.some((p) => p.number === n));
    if (missing.length) throw new DomainError("invalid", `No purchase order ${missing.join(", ")}.`, "numbers");
    const wrong = pos.filter((p) => !WITH_SUPPLIER.includes(p.status) || p.dropShip);
    if (wrong.length) throw new DomainError("invalid", `${wrong.map((p) => p.number).join(", ")} can't travel in it: only purchase orders with the supplier, and not delivered straight to the customer.`, "numbers");
    await tx.purchaseOrder.updateMany({ where: { id: { in: pos.map((p) => p.id) } }, data: { shipmentId: id } });
    const step = LINE_STEP[s.status];
    if (step) await advanceLines(tx, await poLineIds(tx, pos.map((p) => p.id)), step, actor.name, `Shipment ${s.number}`, now);
    await audit(tx, staffAudit(actor, { action: "shipment.purchase-orders", summary: `Put ${pos.map((p) => p.number).join(", ")} on shipment ${s.number}`, targetType: "Shipment", targetId: id, ipAddress: ip }));
  });
}

export async function removePurchaseOrder(db: PrismaClient, actor: StaffActor, id: string, purchaseOrderId: string, ip?: string | null) {
  assertStaffCan(actor, "manageShipments");
  await db.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findFirst({ where: { id: purchaseOrderId, shipmentId: id }, include: { shipment: { select: { number: true } } } });
    if (!po) throw new DomainError("not-found", "That purchase order isn't on this shipment.");
    await tx.purchaseOrder.update({ where: { id: po.id }, data: { shipmentId: null } });
    await audit(tx, staffAudit(actor, { action: "shipment.purchase-orders", summary: `Took ${po.number} off shipment ${po.shipment!.number}`, targetType: "Shipment", targetId: id, ipAddress: ip }));
  });
}

/** Removes a past shipment, such as a demo one or a mistake. Live shipments carry purchase orders and stay. */
export async function deleteShipment(db: PrismaClient, actor: StaffActor, id: string, ip?: string | null) {
  assertStaffCan(actor, "manageShipments");
  await db.$transaction(async (tx) => {
    const s = await tx.shipment.findUnique({ where: { id }, include: { _count: { select: { purchaseOrders: true } } } });
    if (!s) throw new DomainError("not-found", "No such shipment.");
    if (s.source !== "HISTORY" || s._count.purchaseOrders) throw new DomainError("conflict", "Only a past shipment without purchase orders can be removed.");
    await tx.shipment.delete({ where: { id } });
    await audit(tx, staffAudit(actor, { action: "shipment.deleted", summary: `Removed past shipment ${s.number}, ${SHIP_MODE_LABEL[s.mode].toLowerCase()} from ${s.originCountry}`, targetType: "Shipment", targetId: id, ipAddress: ip }));
  });
  await refreshCosts(db);
}

// ─── Importing past shipments ────────────────────────────────────────

export const SHIPMENT_CSV_COLUMNS = ["mode", "origin_country", "destination_country", "carrier", "reference", "weight_kg", "volume_m3", "currency", "goods_value", "freight", "insurance", "duties", "clearing", "other", "shipped_on", "arrived_on", "transit_days", "notes"] as const;

/** A file to fill in, with one example row. */
export function shipmentCsvTemplate() {
  return `${SHIPMENT_CSV_COLUMNS.join(",")}\nROAD,ZA,BW,Example Freight,WB12345,120.5,0.9,ZAR,85000.00,4200.00,0,0,1850.00,0,2026-03-02,2026-03-06,,Example row: replace it\n`;
}

/**
 * Loads past shipments from a CSV file, as history. All or nothing: any
 * row with a problem stops the import, and every problem is listed.
 */
export async function importShipments(db: PrismaClient, actor: StaffActor, csv: string, ip?: string | null, now = new Date()) {
  assertStaffCan(actor, "manageShipments");
  if (!csv.trim()) throw new DomainError("invalid", "Choose a CSV file.", "file");
  const rows = parseCsv(csv);
  const header = (rows.shift() ?? []).map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const missing = SHIPMENT_CSV_COLUMNS.filter((c) => ["mode", "origin_country", "destination_country", "weight_kg", "currency", "freight"].includes(c) && !header.includes(c));
  if (missing.length) throw new DomainError("invalid", `The file needs these columns: ${missing.join(", ")}. Start from the template.`, "file");
  if (!rows.length) throw new DomainError("invalid", "The file has no shipments in it.", "file");
  if (rows.length > 2000) throw new DomainError("invalid", "Load up to 2000 shipments at a time.", "file");
  const cell = (r: string[], c: string) => (header.includes(c) ? (r[header.indexOf(c)] ?? "").trim() : "");
  const problems: string[] = [];
  const parsed: ReturnType<typeof readShipment>[] = [];
  rows.forEach((r, i) => {
    try {
      parsed.push(readShipment({ mode: cell(r, "mode"), originCountry: cell(r, "origin_country"), destinationCountry: cell(r, "destination_country"), carrier: cell(r, "carrier"), reference: cell(r, "reference"), weightKg: cell(r, "weight_kg"), volumeM3: cell(r, "volume_m3"), currency: cell(r, "currency"), goodsValue: cell(r, "goods_value"), freight: cell(r, "freight"), insurance: cell(r, "insurance"), duties: cell(r, "duties"), clearing: cell(r, "clearing"), other: cell(r, "other"), shippedOn: cell(r, "shipped_on"), arrivedOn: cell(r, "arrived_on"), transitDays: cell(r, "transit_days"), notes: cell(r, "notes") }, now));
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      problems.push(`Row ${i + 2}: ${Object.entries(e.fieldErrors ?? {}).map(([f, m]) => `${f} ${m.charAt(0).toLowerCase()}${m.slice(1)}`).join(" ") || e.message}`);
    }
  });
  if (problems.length) throw new DomainError("invalid", `Nothing was loaded. Fix these rows and try again:\n${problems.slice(0, 20).join("\n")}${problems.length > 20 ? `\nand ${problems.length - 20} more` : ""}`, "file");
  await db.$transaction(async (tx) => {
    for (const data of parsed) await tx.shipment.create({ data: { ...data, number: await nextNumber(tx), source: "HISTORY", status: "ARRIVED", createdByLabel: actor.name } });
    await audit(tx, staffAudit(actor, { action: "shipment.imported", summary: `Loaded ${parsed.length} past ${parsed.length === 1 ? "shipment" : "shipments"} from a file`, targetType: "Shipment", ipAddress: ip }));
  }, { timeout: 60_000 });
  await refreshCosts(db);
  return parsed.length;
}

// ─── Reading ─────────────────────────────────────────────────────────

export async function listShipments(db: Pick<PrismaClient, "shipment">, f: { source?: ShipmentSource; status?: ShipmentStatus; q?: string } = {}) {
  const q = f.q?.trim();
  return db.shipment.findMany({
    where: { ...(f.source ? { source: f.source } : {}), ...(f.status ? { status: f.status } : {}), ...(q ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { reference: { contains: q, mode: "insensitive" } }, { carrier: { contains: q, mode: "insensitive" } }, { originCountry: q.toUpperCase() }] } : {}) },
    orderBy: [{ createdAt: "desc" }],
    take: 300,
    include: { _count: { select: { purchaseOrders: true } } },
  });
}

/** Live shipments on their way, for the admin menu. */
export async function shipmentsOnTheWay(db: Pick<PrismaClient, "shipment">) {
  return db.shipment.count({ where: { source: "LIVE", status: { not: "ARRIVED" } } });
}

export async function getShipment(db: Pick<PrismaClient, "shipment">, id: string) {
  const s = await db.shipment.findUnique({ where: { id }, include: { purchaseOrders: { orderBy: { number: "asc" }, include: { supplier: { select: { name: true } }, order: { select: { id: true, number: true } } } } } });
  if (!s) throw new DomainError("not-found", "No such shipment.");
  return s;
}

/** What the shipment cost per chargeable kilogram, in its own currency. */
export function shipmentPerKg(s: { mode: ShipMode; weightGrams: number; volumeCm3: number; freightMinor: bigint }, factors: Parameters<typeof kgPerM3>[1]) {
  const grams = chargeableGrams(s.weightGrams, s.volumeCm3, kgPerM3(s.mode, factors));
  return { chargeableGrams: grams, perKg: grams > 0 ? (s.freightMinor * 1000n) / BigInt(grams) : 0n };
}

// ─── Estimates and overrides ─────────────────────────────────────────

/** Every route into our home country with its estimate, and staff's own figures. */
export async function routeEstimates(db: PrismaClient) {
  const ctx = await landedContext(db);
  const overrides = await db.freightOverride.findMany({ where: { destinationCountry: ctx.home }, orderBy: [{ originCountry: "asc" }, { mode: "asc" }] });
  const routes = [...ctx.routes.entries()].map(([key, est]) => {
    const [origin, mode] = key.split(":") as [string, ShipMode];
    return { origin, mode, ...est, override: overrides.find((o) => o.originCountry === origin && o.mode === mode) ?? null };
  });
  routes.sort((a, b) => a.origin.localeCompare(b.origin) || a.mode.localeCompare(b.mode));
  return { base: ctx.base, home: ctx.home, settings: ctx.settings, routes, overrides };
}

export interface OverrideInput {
  originCountry: string;
  mode: string;
  perKg: string;
  feesPerKg: string;
  transitDays: string;
  note: string;
}

/** Staff set their own figures for a route. Empty fields keep the estimate from history. */
export async function saveOverride(db: PrismaClient, actor: StaffActor, input: OverrideInput, ip?: string | null) {
  assertStaffCan(actor, "manageShipments");
  const [home, base] = await Promise.all([homeCountry(db), db.pricingSettings.findUnique({ where: { id: "global" } }).then((p) => p?.baseCurrency ?? "BWP")]);
  const errors: Record<string, string> = {};
  const originCountry = input.originCountry.trim().toUpperCase();
  const mode = input.mode.trim().toUpperCase() as ShipMode;
  if (!isCountryCode(originCountry)) errors.originCountry = "Enter the two-letter country code, such as ZA.";
  if (!SHIP_MODES.includes(mode)) errors.mode = "Choose air, sea, road or courier.";
  const amount = (field: "perKg" | "feesPerKg") => {
    const t = input[field].trim();
    if (!t) return null;
    try {
      const v = parseMoney(t, base);
      if (v < 0n) throw new Error();
      return v;
    } catch {
      errors[field] = `Enter an amount in ${base} per kilogram.`;
      return null;
    }
  };
  const perKgMinor = amount("perKg");
  const feesPerKgMinor = amount("feesPerKg");
  const t = input.transitDays.trim();
  const transitDays = t ? (/^\d{1,3}$/.test(t) ? Number(t) : NaN) : null;
  if (Number.isNaN(transitDays)) errors.transitDays = "Enter whole days, up to 999.";
  if (perKgMinor === null && feesPerKgMinor === null && transitDays === null && !errors.perKg && !errors.feesPerKg && !errors.transitDays) errors.perKg = "Enter at least one figure.";
  if (Object.keys(errors).length) throw new DomainError("invalid", "Check the highlighted fields.", undefined, errors);
  const note = input.note.trim().slice(0, 300);
  await db.$transaction(async (tx) => {
    const key = { originCountry_destinationCountry_mode: { originCountry, destinationCountry: home, mode } };
    const data = { perKgMinor, feesPerKgMinor, transitDays, note, updatedByLabel: actor.name };
    const o = await tx.freightOverride.upsert({ where: key, create: { originCountry, destinationCountry: home, mode, ...data }, update: data });
    const shown = (n: bigint | null) => (n === null ? "from history" : `${money(n, base)} a kg`);
    await audit(tx, staffAudit(actor, { action: "freight.override", summary: `Set ${SHIP_MODE_LABEL[mode].toLowerCase()} freight from ${originCountry}: ${shown(perKgMinor)}, fees ${shown(feesPerKgMinor)}${transitDays !== null ? `, ${transitDays} days` : ""}${note ? ` (${note})` : ""}`, targetType: "FreightOverride", targetId: o.id, ipAddress: ip }));
  });
  await refreshCosts(db);
}

export async function deleteOverride(db: PrismaClient, actor: StaffActor, id: string, ip?: string | null) {
  assertStaffCan(actor, "manageShipments");
  await db.$transaction(async (tx) => {
    const o = await tx.freightOverride.findUnique({ where: { id } });
    if (!o) throw new DomainError("not-found", "No such figure.");
    await tx.freightOverride.delete({ where: { id } });
    await audit(tx, staffAudit(actor, { action: "freight.override", summary: `Went back to history for ${SHIP_MODE_LABEL[o.mode].toLowerCase()} freight from ${o.originCountry}`, targetType: "FreightOverride", targetId: id, ipAddress: ip }));
  });
  await refreshCosts(db);
}

export interface CalculatorInput {
  originCountry: string;
  mode: string;
  weightKg: string;
  volumeM3: string;
  goodsValue: string;
}

/** What a consignment should cost to bring in, from the estimates. Null when there's no estimate for the route. */
export async function estimateConsignment(db: PrismaClient, input: CalculatorInput) {
  const ctx = await landedContext(db);
  const errors: Record<string, string> = {};
  const origin = input.originCountry.trim().toUpperCase();
  const mode = input.mode.trim().toUpperCase() as ShipMode;
  if (!isCountryCode(origin)) errors.originCountry = "Enter the two-letter country code, such as ZA.";
  if (!SHIP_MODES.includes(mode)) errors.mode = "Choose air, sea, road or courier.";
  const weightKg = decimal(input.weightKg, 1_000_000);
  if (weightKg === null || Number.isNaN(weightKg) || weightKg <= 0) errors.weightKg = "Enter the weight in kilograms.";
  const volumeM3 = decimal(input.volumeM3, 10_000);
  if (Number.isNaN(volumeM3)) errors.volumeM3 = "Enter the volume in cubic metres, or leave it empty.";
  let goodsValue = 0n;
  if (input.goodsValue.trim()) {
    try {
      goodsValue = parseMoney(input.goodsValue, ctx.base);
    } catch {
      errors.goodsValue = `Enter the value in ${ctx.base}.`;
    }
  }
  if (Object.keys(errors).length) throw new DomainError("invalid", "Check the highlighted fields.", undefined, errors);
  const route = routeEstimate(ctx, origin, mode);
  if (!route) return { base: ctx.base, home: ctx.home, route: null };
  const grams = chargeableGrams(Math.round(weightKg! * 1000), Math.round((volumeM3 ?? 0) * 1_000_000), kgPerM3(mode, ctx.settings));
  const freight = (route.perKg * BigInt(grams) + 999n) / 1000n;
  const fees = (route.feesPerKg * BigInt(grams) + 999n) / 1000n;
  const insurance = applyBps(goodsValue, route.insuranceBps ?? ctx.settings.insuranceBps);
  return { base: ctx.base, home: ctx.home, route, chargeableGrams: grams, freight, fees, insurance, total: freight + fees + insurance };
}

