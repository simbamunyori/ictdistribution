import type { PrismaClient } from "@prisma/client";
import { mpnKey } from "@/lib/catalogue";
import { formatMoney, parseMoney } from "@/lib/money";
import { audit, staffAudit } from "@/server/audit";
import { DomainError } from "@/server/errors";
import { assertStaffCan, type StaffActor } from "@/server/staff/access";

/**
 * The shop's own settings: the home page, featured products, how long a
 * bank transfer may take, and per market the tax, delivery, collection
 * points and bank details. All edited in the admin area.
 */

export async function shopSettings(db: Pick<PrismaClient, "shopSettings">) {
  return db.shopSettings.upsert({ where: { id: "global" }, create: { id: "global" }, update: {} });
}

export interface ShopSettingsInput {
  heroTitle: string;
  heroText: string;
  payDays: string;
  maxLineQuantity: string;
  returnDays: string;
}

export async function updateShopSettings(db: PrismaClient, actor: StaffActor, input: ShopSettingsInput, ip?: string | null) {
  assertStaffCan(actor, "manageShop");
  const fieldErrors: Record<string, string> = {};
  const heroTitle = input.heroTitle.trim().replace(/\s+/g, " ");
  const heroText = input.heroText.trim().replace(/\s+/g, " ");
  if (heroTitle.length < 5 || heroTitle.length > 100) fieldErrors.heroTitle = "Enter a headline of 5 to 100 characters.";
  if (heroText.length > 240) fieldErrors.heroText = "Keep it under 240 characters.";
  const payDays = Number(input.payDays);
  if (!Number.isInteger(payDays) || payDays < 1 || payDays > 14) fieldErrors.payDays = "Enter whole days from 1 to 14.";
  const maxLineQuantity = Number(input.maxLineQuantity);
  if (!Number.isInteger(maxLineQuantity) || maxLineQuantity < 1 || maxLineQuantity > 500) fieldErrors.maxLineQuantity = "Enter a whole number from 1 to 500.";
  const returnDays = Number(input.returnDays);
  if (!Number.isInteger(returnDays) || returnDays < 0 || returnDays > 365) fieldErrors.returnDays = "Enter whole days from 0 to 365.";
  if (Object.keys(fieldErrors).length) throw new DomainError("invalid", "Check the highlighted fields.", undefined, fieldErrors);
  await db.$transaction(async (tx) => {
    await tx.shopSettings.upsert({ where: { id: "global" }, create: { id: "global", heroTitle, heroText, payDays, maxLineQuantity, returnDays }, update: { heroTitle, heroText, payDays, maxLineQuantity, returnDays } });
    await audit(tx, staffAudit(actor, { action: "shop.settings", summary: `Changed the shop settings: ${payDays} days to pay by bank transfer, up to ${maxLineQuantity} of one item per order, returns within ${returnDays} days`, ipAddress: ip }));
  });
}

// ─── Featured products ───────────────────────────────────────────────

export async function featuredIds(db: Pick<PrismaClient, "featuredProduct">) {
  return (await db.featuredProduct.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { productId: true } })).map((f) => f.productId);
}

export async function featuredForAdmin(db: Pick<PrismaClient, "featuredProduct">) {
  return db.featuredProduct.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], include: { product: { select: { id: true, name: true, mpn: true, status: true, sellToIndividuals: true, brand: { select: { name: true } } } } } });
}

/** Finds a product from what staff type: its part number, or its address in the shop. */
export async function productByReference(db: Pick<PrismaClient, "product">, reference: string, field = "reference") {
  const ref = reference.trim();
  if (!ref) throw new DomainError("invalid", "Enter a part number or the product's address.", field);
  const slug = ref.replace(/^.*\/products\//, "").replace(/[?#].*$/, "");
  const found = (await db.product.findUnique({ where: { slug } })) ?? null;
  const byMpn = found ? [found] : await db.product.findMany({ where: { mpnKey: mpnKey(ref) }, take: 2 });
  if (byMpn.length > 1) throw new DomainError("conflict", `Several products have the part number ${ref}. Paste the product's address instead.`, field);
  if (!byMpn[0]) throw new DomainError("not-found", `No product has the part number or address ${ref}.`, field);
  return byMpn[0];
}

/** Adds a product to the home page by part number or address. */
export async function addFeatured(db: PrismaClient, actor: StaffActor, reference: string, ip?: string | null) {
  assertStaffCan(actor, "manageShop");
  const p = await productByReference(db, reference);
  if (p.status !== "ACTIVE") throw new DomainError("invalid", `${p.name} isn't in the shop. Set it to In the shop first.`, "reference");
  await db.$transaction(async (tx) => {
    if (await tx.featuredProduct.findUnique({ where: { productId: p.id } })) return;
    const last = await tx.featuredProduct.findFirst({ orderBy: { sortOrder: "desc" } });
    await tx.featuredProduct.create({ data: { productId: p.id, sortOrder: (last?.sortOrder ?? 0) + 10 } });
    await audit(tx, staffAudit(actor, { action: "shop.featured-added", summary: `Featured ${p.name} on the home page`, targetType: "Product", targetId: p.id, ipAddress: ip }));
  });
}

export async function removeFeatured(db: PrismaClient, actor: StaffActor, productId: string, ip?: string | null) {
  assertStaffCan(actor, "manageShop");
  await db.$transaction(async (tx) => {
    const f = await tx.featuredProduct.findUnique({ where: { productId }, include: { product: { select: { name: true } } } });
    if (!f) return;
    await tx.featuredProduct.delete({ where: { productId } });
    await audit(tx, staffAudit(actor, { action: "shop.featured-removed", summary: `Took ${f.product.name} off the home page`, targetType: "Product", targetId: productId, ipAddress: ip }));
  });
}

export async function moveFeaturedUp(db: PrismaClient, actor: StaffActor, productId: string) {
  assertStaffCan(actor, "manageShop");
  await db.$transaction(async (tx) => {
    const list = await tx.featuredProduct.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
    const i = list.findIndex((f) => f.productId === productId);
    if (i <= 0) return;
    [list[i - 1], list[i]] = [list[i], list[i - 1]];
    for (const [n, f] of list.entries()) await tx.featuredProduct.update({ where: { productId: f.productId }, data: { sortOrder: (n + 1) * 10 } });
  });
}

// ─── Selling in a market ─────────────────────────────────────────────

export interface TaxInput {
  taxName: string;
  taxPercent: string;
  bankDetails: string;
  /** Our tax registration number there. Left as it is when not given. */
  taxNumber?: string;
}

/** Tax and bank details: Admin only, since they change what customers pay and where the money goes. */
export async function updateMarketTaxAndBank(db: PrismaClient, actor: StaffActor, code: string, input: TaxInput, ip?: string | null) {
  assertStaffCan(actor, "manageMarkets");
  const fieldErrors: Record<string, string> = {};
  const taxName = input.taxName.trim();
  if (taxName.length < 2 || taxName.length > 20) fieldErrors.taxName = "Enter the tax's name, like VAT.";
  const pct = Number(input.taxPercent);
  if (!Number.isFinite(pct) || pct < 0 || pct > 40) fieldErrors.taxPercent = "Enter a percentage from 0 to 40.";
  const bankDetails = input.bankDetails.trim().replace(/\r\n/g, "\n");
  if (bankDetails.length > 600) fieldErrors.bankDetails = "Keep it under 600 characters.";
  const taxNumber = (input.taxNumber ?? "").trim();
  if (taxNumber.length > 40) fieldErrors.taxNumber = "Keep it under 40 characters.";
  if (Object.keys(fieldErrors).length) throw new DomainError("invalid", "Check the highlighted fields.", undefined, fieldErrors);
  const taxRateBps = Math.round(pct * 100);
  await db.$transaction(async (tx) => {
    const before = await tx.market.findUnique({ where: { code } });
    if (!before) throw new DomainError("not-found", "No such market.");
    await tx.market.update({ where: { code }, data: { taxName, taxRateBps, bankDetails, ...(input.taxNumber === undefined ? {} : { taxNumber }) } });
    const changes: string[] = [];
    if (before.taxName !== taxName || before.taxRateBps !== taxRateBps) changes.push(`${taxName} ${before.taxRateBps / 100}% to ${taxRateBps / 100}%`);
    if (input.taxNumber !== undefined && before.taxNumber !== taxNumber) changes.push(taxNumber ? `tax number ${taxNumber}` : "tax number removed");
    if (before.bankDetails !== bankDetails) changes.push(bankDetails ? "bank details changed" : "bank transfer switched off");
    if (changes.length) await audit(tx, staffAudit(actor, { action: "market.selling", summary: `Changed ${before.name}: ${changes.join(", ")}`, targetType: "Market", targetId: code, data: before.bankDetails !== bankDetails ? { bankDetails: { from: before.bankDetails, to: bankDetails } } : undefined, ipAddress: ip }));
  });
}

export interface DeliveryInput {
  deliveryEnabled: boolean;
  deliveryFee: string;
  freeDeliveryFrom: string;
  deliveryNote: string;
}

export async function updateMarketDelivery(db: PrismaClient, actor: StaffActor, code: string, input: DeliveryInput, ip?: string | null) {
  assertStaffCan(actor, "manageShop");
  const market = await db.market.findUnique({ where: { code } });
  if (!market) throw new DomainError("not-found", "No such market.");
  const fieldErrors: Record<string, string> = {};
  const amount = (v: string, key: string, empty: bigint | null) => {
    if (!v.trim()) return empty;
    try {
      const n = parseMoney(v, market.currency);
      if (n < 0n) throw new Error();
      return n;
    } catch {
      fieldErrors[key] = `Enter an amount in ${market.currency}.`;
      return null;
    }
  };
  const deliveryFeeMinor = amount(input.deliveryFee, "deliveryFee", 0n) ?? 0n;
  const freeDeliveryMinor = amount(input.freeDeliveryFrom, "freeDeliveryFrom", null);
  const deliveryNote = input.deliveryNote.trim();
  if (deliveryNote.length > 200) fieldErrors.deliveryNote = "Keep it under 200 characters.";
  if (Object.keys(fieldErrors).length) throw new DomainError("invalid", "Check the highlighted fields.", undefined, fieldErrors);
  await db.$transaction(async (tx) => {
    await tx.market.update({ where: { code }, data: { deliveryEnabled: input.deliveryEnabled, deliveryFeeMinor, freeDeliveryMinor, deliveryNote } });
    const fee = formatMoney({ amountMinor: deliveryFeeMinor, currency: market.currency }, market.locale);
    const free = freeDeliveryMinor !== null ? `, free from ${formatMoney({ amountMinor: freeDeliveryMinor, currency: market.currency }, market.locale)}` : "";
    await audit(tx, staffAudit(actor, { action: "market.delivery", summary: input.deliveryEnabled ? `Delivery in ${market.name}: ${fee}${free}` : `Switched off delivery in ${market.name}`, targetType: "Market", targetId: code, ipAddress: ip }));
  });
}

export interface CollectionPointInput {
  name: string;
  address: string;
  hours: string;
}

export async function addCollectionPoint(db: PrismaClient, actor: StaffActor, marketCode: string, input: CollectionPointInput, ip?: string | null) {
  assertStaffCan(actor, "manageShop");
  const name = input.name.trim();
  const address = input.address.trim();
  const hours = input.hours.trim();
  const fieldErrors: Record<string, string> = {};
  if (name.length < 2 || name.length > 80) fieldErrors.name = "Enter the place's name.";
  if (address.length < 5 || address.length > 300) fieldErrors.address = "Enter the address.";
  if (hours.length > 120) fieldErrors.hours = "Keep it under 120 characters.";
  if (Object.keys(fieldErrors).length) throw new DomainError("invalid", "Check the highlighted fields.", undefined, fieldErrors);
  await db.$transaction(async (tx) => {
    const m = await tx.market.findUnique({ where: { code: marketCode } });
    if (!m) throw new DomainError("not-found", "No such market.");
    const p = await tx.collectionPoint.create({ data: { marketCode, name, address, hours } });
    await audit(tx, staffAudit(actor, { action: "market.collection-added", summary: `Added the collection point ${name} in ${m.name}`, targetType: "CollectionPoint", targetId: p.id, ipAddress: ip }));
  });
}

export async function setCollectionPointActive(db: PrismaClient, actor: StaffActor, id: string, active: boolean, ip?: string | null) {
  assertStaffCan(actor, "manageShop");
  await db.$transaction(async (tx) => {
    const p = await tx.collectionPoint.update({ where: { id }, data: { active } });
    await audit(tx, staffAudit(actor, { action: "market.collection-changed", summary: `${active ? "Opened" : "Closed"} the collection point ${p.name}`, targetType: "CollectionPoint", targetId: id, ipAddress: ip }));
  });
}
