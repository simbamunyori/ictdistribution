import type { CustomerTypeCode, Prisma, PrismaClient, Special, SpecialKind } from "@prisma/client";
import { DEFAULT_TIME_ZONE } from "@/config/app";
import { slugify } from "@/lib/catalogue";
import { parseMoney } from "@/lib/money";
import { fromLocalInput } from "@/lib/zoned";
import { audit, staffAudit } from "@/server/audit";
import { DomainError } from "@/server/errors";
import { assertStaffCan, type StaffActor } from "@/server/staff/access";
import { refreshCosts } from "./costs";

/**
 * Specials: a lower price for a product, a percentage off a category, or
 * several products together at one price. Each has dates, an optional
 * limit, the customer types it is for, and may be shown on the home
 * page. Set at /admin/specials.
 */

export const SPECIAL_KIND_LABEL: Record<SpecialKind, string> = { PRODUCT: "One product", CATEGORY: "A category", BUNDLE: "A bundle" };
export const CUSTOMER_TYPES: CustomerTypeCode[] = ["INDIVIDUAL", "BUSINESS", "RESELLER", "GOVERNMENT"];

export type SpecialState = "upcoming" | "running" | "ended" | "sold-out" | "off";

export function specialState(s: Pick<Special, "active" | "startsAt" | "endsAt" | "quantityLimit" | "quantityUsed">, now = new Date()): SpecialState {
  if (!s.active) return "off";
  if (s.endsAt <= now) return "ended";
  if (s.quantityLimit !== null && s.quantityUsed >= s.quantityLimit) return "sold-out";
  if (s.startsAt > now) return "upcoming";
  return "running";
}

export const SPECIAL_STATE_LABEL: Record<SpecialState, string> = { upcoming: "Starts later", running: "Running", ended: "Ended", "sold-out": "Sold out", off: "Switched off" };

export async function listSpecials(db: Pick<PrismaClient, "special">) {
  return db.special.findMany({
    orderBy: [{ endsAt: "desc" }],
    take: 300,
    include: { market: { select: { name: true, currency: true, locale: true } }, category: { select: { name: true } }, items: { include: { product: { select: { name: true, mpn: true, brand: { select: { name: true } } } } } } },
  });
}

export async function getSpecial(db: Pick<PrismaClient, "special">, id: string) {
  const s = await db.special.findUnique({ where: { id }, include: { market: true, items: { include: { product: { select: { id: true, name: true, mpn: true, slug: true, brand: { select: { name: true } } } } } } } });
  if (!s) throw new DomainError("not-found", "No such special.");
  return s;
}

// ─── Editing ─────────────────────────────────────────────────────────

export interface SpecialInput {
  name: string;
  description: string;
  kind: SpecialKind;
  /** PRODUCT: one product. BUNDLE: two to six, with quantities. */
  items: { productId: string; quantity: number }[];
  categoryId: string;
  /** "percent" or "price". */
  mode: string;
  percent: string;
  price: string;
  /** Empty for every market. A fixed price needs one. */
  marketCode: string;
  /** datetime-local values, in the shop's time zone. */
  startsAt: string;
  endsAt: string;
  quantityLimit: string;
  perOrderLimit: string;
  customerTypes: string[];
  featured: boolean;
  active: boolean;
}

type Checked = {
  name: string;
  description: string;
  kind: SpecialKind;
  items: { productId: string; quantity: number }[];
  categoryId: string | null;
  discountBps: number | null;
  priceMinor: bigint | null;
  marketCode: string | null;
  startsAt: Date;
  endsAt: Date;
  quantityLimit: number | null;
  perOrderLimit: number | null;
  customerTypes: CustomerTypeCode[];
  featured: boolean;
  active: boolean;
};

async function checkSpecial(db: Prisma.TransactionClient, input: SpecialInput): Promise<Checked> {
  const fieldErrors: Record<string, string> = {};
  const name = input.name.trim().replace(/\s+/g, " ");
  const description = input.description.trim();
  if (name.length < 3 || name.length > 80) fieldErrors.name = "Enter a name of 3 to 80 characters.";
  if (description.length > 500) fieldErrors.description = "Keep it under 500 characters.";
  if (!["PRODUCT", "CATEGORY", "BUNDLE"].includes(input.kind)) fieldErrors.kind = "Choose what the special is on.";

  const items = [...new Map(input.items.filter((i) => i.productId).map((i) => [i.productId, i])).values()];
  let categoryId: string | null = null;
  if (input.kind === "PRODUCT" && items.length !== 1) fieldErrors.items = "Choose the product.";
  if (input.kind === "BUNDLE" && (items.length < 2 || items.length > 6)) fieldErrors.items = "Choose two to six products.";
  if (items.some((i) => !Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > 10)) fieldErrors.items = "Quantities are whole numbers from 1 to 10.";
  if (input.kind !== "CATEGORY" && items.length && !fieldErrors.items) {
    const found = await db.product.findMany({ where: { id: { in: items.map((i) => i.productId) } }, select: { id: true, sellToIndividuals: true, name: true } });
    if (found.length !== items.length) fieldErrors.items = "A chosen product no longer exists.";
    const notRetail = found.find((p) => !p.sellToIndividuals);
    if (notRetail) fieldErrors.items = `${notRetail.name} isn't sold to individuals, so it has no shop price to reduce.`;
  }
  if (input.kind === "CATEGORY") {
    if (!input.categoryId || !(await db.category.findUnique({ where: { id: input.categoryId } }))) fieldErrors.categoryId = "Choose a category.";
    categoryId = input.categoryId || null;
  }

  const marketCode = input.marketCode.trim() || null;
  const market = marketCode ? await db.market.findUnique({ where: { code: marketCode } }) : null;
  if (marketCode && !market) fieldErrors.marketCode = "Choose a market.";
  let discountBps: number | null = null;
  let priceMinor: bigint | null = null;
  if (input.mode === "percent") {
    const n = Number(input.percent);
    if (!Number.isFinite(n) || n < 1 || n > 90) fieldErrors.percent = "Enter a percentage from 1 to 90.";
    else discountBps = Math.round(n * 100);
  } else if (input.mode === "price") {
    if (input.kind === "CATEGORY") fieldErrors.mode = "A category special takes a percentage off.";
    else if (!market) fieldErrors.marketCode = "A fixed price is in one market's currency. Choose the market.";
    else {
      try {
        priceMinor = parseMoney(input.price, market.currency);
        if (priceMinor <= 0n) throw new Error();
      } catch {
        fieldErrors.price = `Enter the price in ${market.currency}, including ${market.taxName}.`;
      }
    }
  } else fieldErrors.mode = "Choose a percentage off or a fixed price.";

  const startsAt = fromLocalInput(input.startsAt, DEFAULT_TIME_ZONE);
  const endsAt = fromLocalInput(input.endsAt, DEFAULT_TIME_ZONE);
  if (!startsAt) fieldErrors.startsAt = "Enter when it starts.";
  if (!endsAt) fieldErrors.endsAt = "Enter when it ends.";
  else if (startsAt && endsAt <= startsAt) fieldErrors.endsAt = "It must end after it starts.";

  const whole = (v: string, key: string) => {
    if (!v.trim()) return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 100_000) fieldErrors[key] = "Enter a whole number from 1, or leave it empty.";
    return n;
  };
  const quantityLimit = whole(input.quantityLimit, "quantityLimit");
  const perOrderLimit = whole(input.perOrderLimit, "perOrderLimit");
  const customerTypes = CUSTOMER_TYPES.filter((t) => input.customerTypes.includes(t));
  if (!customerTypes.length) fieldErrors.customerTypes = "Choose at least one customer type.";
  if (Object.keys(fieldErrors).length) throw new DomainError("invalid", "Check the highlighted fields.", undefined, fieldErrors);
  return { name, description, kind: input.kind, items: input.kind === "CATEGORY" ? [] : items, categoryId: input.kind === "CATEGORY" ? categoryId : null, discountBps, priceMinor, marketCode, startsAt: startsAt!, endsAt: endsAt!, quantityLimit, perOrderLimit, customerTypes, featured: input.featured, active: input.active };
}

async function freeSlug(tx: Prisma.TransactionClient, name: string, id: string | null) {
  const wanted = slugify(name) || "special";
  for (let n = 1; ; n++) {
    const slug = n === 1 ? wanted : `${wanted}-${n}`;
    const clash = await tx.special.findUnique({ where: { slug } });
    if (!clash || clash.id === id) return slug;
  }
}

function dataOf(v: Checked) {
  const { items: _items, ...rest } = v;
  return rest;
}

export async function createSpecial(db: PrismaClient, actor: StaffActor, input: SpecialInput, ip?: string | null, now = new Date()): Promise<Special> {
  assertStaffCan(actor, "manageShop");
  return db.$transaction(async (tx) => {
    const v = await checkSpecial(tx, input);
    if (v.endsAt <= now) throw new DomainError("invalid", "Check the highlighted fields.", undefined, { endsAt: "It must end in the future." });
    const s = await tx.special.create({ data: { ...dataOf(v), slug: await freeSlug(tx, v.name, null), items: { create: v.items } } });
    await audit(tx, staffAudit(actor, { action: "special.created", summary: `Added the special ${v.name}`, targetType: "Special", targetId: s.id, ipAddress: ip }));
    return s;
  });
}

export async function updateSpecial(db: PrismaClient, actor: StaffActor, id: string, input: SpecialInput, ip?: string | null): Promise<Special> {
  assertStaffCan(actor, "manageShop");
  return db.$transaction(async (tx) => {
    const before = await tx.special.findUnique({ where: { id } });
    if (!before) throw new DomainError("not-found", "No such special.");
    const v = await checkSpecial(tx, input);
    if (before.quantityUsed > 0 && v.kind !== before.kind) throw new DomainError("conflict", "Orders already use this special, so what it is on stays the same. End it and add a new one.", "kind");
    if (v.quantityLimit !== null && v.quantityLimit < before.quantityUsed) throw new DomainError("invalid", `Orders already took ${before.quantityUsed}. The limit can't be lower.`, "quantityLimit");
    await tx.specialItem.deleteMany({ where: { specialId: id } });
    const s = await tx.special.update({ where: { id }, data: { ...dataOf(v), slug: before.name === v.name ? before.slug : await freeSlug(tx, v.name, id), items: { create: v.items } } });
    await audit(tx, staffAudit(actor, { action: "special.updated", summary: `Changed the special ${v.name}`, targetType: "Special", targetId: id, ipAddress: ip }));
    return s;
  });
}

/** Ends a special now. It stays in the list with its history. */
export async function endSpecial(db: PrismaClient, actor: StaffActor, id: string, ip?: string | null, now = new Date()) {
  assertStaffCan(actor, "manageShop");
  await db.$transaction(async (tx) => {
    const s = await tx.special.findUnique({ where: { id } });
    if (!s || s.endsAt <= now) return;
    await tx.special.update({ where: { id }, data: { endsAt: now, ...(s.startsAt > now ? { startsAt: now } : {}) } });
    await audit(tx, staffAudit(actor, { action: "special.ended", summary: `Ended the special ${s.name}`, targetType: "Special", targetId: id, ipAddress: ip }));
  });
}

// ─── Launching our own stock as a special ────────────────────────────

export interface ConsignmentInput {
  productId: string;
  units: string;
  /** Our landed cost per unit, in `currency`. */
  unitCost: string;
  currency: string;
  special: Omit<SpecialInput, "kind" | "items" | "quantityLimit">;
}

/**
 * Stock we bring in ourselves (a laptop consignment, say), on sale in one
 * step: records it as an offer from our own stock, with its landed cost
 * and units, and starts a special on the product limited to those units.
 */
export async function launchConsignment(db: PrismaClient, actor: StaffActor, input: ConsignmentInput, ip?: string | null, now = new Date()) {
  assertStaffCan(actor, "manageShop");
  const units = Number(input.units);
  if (!Number.isInteger(units) || units < 1 || units > 100_000) throw new DomainError("invalid", "Enter how many units arrived.", "units");
  const currency = input.currency.trim().toUpperCase();
  if (!(await db.currency.findFirst({ where: { code: currency, enabled: true } }))) throw new DomainError("invalid", "Choose a currency.", "currency");
  const product = await db.product.findUnique({ where: { id: input.productId }, select: { id: true, name: true } });
  if (!product) throw new DomainError("invalid", "Choose the product.", "productId");
  // Check the special before touching stock, so a mistake changes nothing.
  const specialInput: SpecialInput = { ...input.special, kind: "PRODUCT", items: [{ productId: product.id, quantity: 1 }], quantityLimit: String(units) };
  await db.$transaction((tx) => checkSpecial(tx, specialInput));

  let costMinor: bigint;
  try {
    costMinor = parseMoney(input.unitCost, currency);
    if (costMinor <= 0n) throw new Error();
  } catch {
    throw new DomainError("invalid", `Enter the landed cost per unit in ${currency}.`, "unitCost");
  }
  const supplierName = `Our stock (${currency})`;
  const ours =
    (await db.supplier.findFirst({ where: { name: supplierName } })) ??
    (await db.supplier.create({ data: { name: supplierName, kind: "LOCAL", country: "BW", currency, leadTimeDays: 1, landedCostBps: 0, preferred: true, notes: "Stock we hold ourselves, from consignments launched as specials." } }));
  await db.supplierOffer.upsert({
    where: { supplierId_productId: { supplierId: ours.id, productId: product.id } },
    create: { supplierId: ours.id, productId: product.id, costMinor, currency, stock: units, leadTimeDays: 1, active: true, source: "consignment", priceUpdatedAt: now },
    update: { costMinor, currency, stock: units, leadTimeDays: 1, active: true, source: "consignment", priceUpdatedAt: now },
  });
  await refreshCosts(db, [product.id], now);
  const special = await createSpecial(db, actor, specialInput, ip, now);
  await audit(db, staffAudit(actor, { action: "special.consignment", summary: `Launched ${units} units of ${product.name} as the special ${special.name}`, targetType: "Special", targetId: special.id, ipAddress: ip }));
  return special;
}
