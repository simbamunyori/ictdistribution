import type { PrismaClient, Supplier, SupplierEventKind, SupplierKind } from "@prisma/client";
import { isCountryCode } from "@/lib/countries";
import { parseMoney, toPlainAmount } from "@/lib/money";
import { audit, staffAudit } from "@/server/audit";
import { DomainError } from "@/server/errors";
import { assertStaffCan, type StaffActor } from "@/server/staff/access";

/**
 * Suppliers and what they charge us. Internal only: nothing here is
 * ever read by a customer page. Edited at /admin/suppliers by Admin and
 * Procurement; Sales, Logistics and Finance can read it.
 */

export const SUPPLIER_KIND_LABEL: Record<SupplierKind, string> = { LOCAL: "Local distributor", INTERNATIONAL: "International", CHINA: "China-based" };
export const EVENT_KIND_LABEL: Record<SupplierEventKind, string> = { ON_TIME: "Delivered on time", LATE: "Delivered late", QUALITY_ISSUE: "Quality problem", WRONG_ITEM: "Wrong item sent", NOTE: "Note" };
const KINDS: SupplierKind[] = ["LOCAL", "INTERNATIONAL", "CHINA"];
const EVENT_KINDS: SupplierEventKind[] = ["ON_TIME", "LATE", "QUALITY_ISSUE", "WRONG_ITEM", "NOTE"];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+[1-9]\d{6,14}$/;

/** "+267 71 234 567" to "+26771234567". Empty stays empty. */
export function normalisePhone(input: string): string {
  return input.replace(/[\s()-]/g, "");
}

function httpsUrl(input: string): string | null {
  const v = input.trim();
  if (!v) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    if (u.protocol !== "https:" && u.protocol !== "http:") return "";
    return u.toString();
  } catch {
    return "";
  }
}

export async function listSuppliers(db: Pick<PrismaClient, "supplier">) {
  return db.supplier.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: { _count: { select: { offers: { where: { active: true } } } }, categories: { include: { category: { select: { name: true } } } }, imports: { where: { status: "READY" }, select: { id: true } } },
  });
}

export async function getSupplier(db: Pick<PrismaClient, "supplier">, id: string) {
  const s = await db.supplier.findUnique({
    where: { id },
    include: {
      contacts: { orderBy: { createdAt: "asc" } },
      categories: { include: { category: { select: { id: true, name: true, parent: { select: { name: true } } } } } },
      events: { orderBy: { occurredAt: "desc" }, take: 50 },
      format: true,
      imports: { orderBy: { createdAt: "desc" }, take: 10, select: { id: true, filename: true, origin: true, status: true, summary: true, largestMoveBps: true, createdAt: true, createdByLabel: true, decidedAt: true, decidedByLabel: true } },
      _count: { select: { offers: true } },
    },
  });
  if (!s) throw new DomainError("not-found", "No such supplier.");
  return s;
}

/** On-time share and problems over the last year, from the performance record. */
export async function performance(db: Pick<PrismaClient, "supplierEvent">, supplierId: string, now = new Date()) {
  const since = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  const rows = await db.supplierEvent.groupBy({ by: ["kind"], where: { supplierId, occurredAt: { gte: since } }, _count: { _all: true } });
  const n = (k: SupplierEventKind) => rows.find((r) => r.kind === k)?._count._all ?? 0;
  const deliveries = n("ON_TIME") + n("LATE");
  return { deliveries, onTimePercent: deliveries ? Math.round((n("ON_TIME") / deliveries) * 100) : null, problems: n("QUALITY_ISSUE") + n("WRONG_ITEM") };
}

// ─── Editing ─────────────────────────────────────────────────────────

export interface SupplierInput {
  name: string;
  kind: SupplierKind;
  country: string;
  currency: string;
  email: string;
  whatsapp: string;
  phone: string;
  website: string;
  portalUrl: string;
  notes: string;
  leadTimeDays: string;
  minOrder: string;
  landedCostPercent: string;
  preferred: boolean;
  active: boolean;
}

async function checkSupplier(db: Pick<PrismaClient, "currency">, input: SupplierInput) {
  const fieldErrors: Record<string, string> = {};
  const name = input.name.trim().replace(/\s+/g, " ");
  const country = input.country.trim().toUpperCase();
  const currency = input.currency.trim().toUpperCase();
  const email = input.email.trim().toLowerCase() || null;
  const whatsapp = normalisePhone(input.whatsapp) || null;
  const phone = normalisePhone(input.phone) || null;
  const website = httpsUrl(input.website);
  const portalUrl = httpsUrl(input.portalUrl);
  const notes = input.notes.trim();
  if (name.length < 2 || name.length > 120) fieldErrors.name = "Enter their name.";
  if (!KINDS.includes(input.kind)) fieldErrors.kind = "Choose a kind.";
  if (!isCountryCode(country)) fieldErrors.country = "Choose a country.";
  if (!(await db.currency.findUnique({ where: { code: currency } }))) fieldErrors.currency = "Choose a currency. Add new ones at Markets.";
  if (email && !EMAIL.test(email)) fieldErrors.email = "Enter a valid email address.";
  if (whatsapp && !PHONE.test(whatsapp)) fieldErrors.whatsapp = "Use the international format, like +86 138 0000 0000.";
  if (phone && !PHONE.test(phone)) fieldErrors.phone = "Use the international format, like +27 11 000 0000.";
  if (website === "") fieldErrors.website = "Enter a web address.";
  if (portalUrl === "") fieldErrors.portalUrl = "Enter a web address.";
  if (notes.length > 4000) fieldErrors.notes = "Keep it under 4,000 characters.";
  const leadTimeDays = Number(input.leadTimeDays);
  if (!Number.isInteger(leadTimeDays) || leadTimeDays < 0 || leadTimeDays > 365) fieldErrors.leadTimeDays = "Enter whole days, 0 to 365.";
  const landed = Number(input.landedCostPercent || "0");
  if (!Number.isFinite(landed) || landed < 0 || landed > 200) fieldErrors.landedCostPercent = "Enter a percentage from 0 to 200.";
  let minOrderMinor: bigint | null = null;
  if (input.minOrder.trim() && !fieldErrors.currency) {
    try {
      minOrderMinor = parseMoney(input.minOrder, currency);
      if (minOrderMinor < 0n) throw new Error();
    } catch {
      fieldErrors.minOrder = "Enter an amount in their currency, or leave it empty.";
    }
  }
  if (Object.keys(fieldErrors).length) throw new DomainError("invalid", "Check the highlighted fields.", undefined, fieldErrors);
  return { name, kind: input.kind, country, currency, email, whatsapp, phone, website, portalUrl, notes, leadTimeDays, minOrderMinor, landedCostBps: Math.round(landed * 100), preferred: input.preferred, active: input.active };
}

export async function createSupplier(db: PrismaClient, actor: StaffActor, input: SupplierInput, ip?: string | null): Promise<Supplier> {
  assertStaffCan(actor, "manageSuppliers");
  const data = await checkSupplier(db, input);
  return db.$transaction(async (tx) => {
    if (await tx.supplier.findFirst({ where: { name: { equals: data.name, mode: "insensitive" } } })) throw new DomainError("conflict", "There is already a supplier with this name.", "name");
    const s = await tx.supplier.create({ data });
    await audit(tx, staffAudit(actor, { action: "supplier.created", summary: `Added the supplier ${data.name}`, targetType: "Supplier", targetId: s.id, ipAddress: ip }));
    return s;
  });
}

export async function updateSupplier(db: PrismaClient, actor: StaffActor, id: string, input: SupplierInput, ip?: string | null): Promise<Supplier> {
  assertStaffCan(actor, "manageSuppliers");
  const data = await checkSupplier(db, input);
  return db.$transaction(async (tx) => {
    const before = await tx.supplier.findUnique({ where: { id } });
    if (!before) throw new DomainError("not-found", "No such supplier.");
    const clash = await tx.supplier.findFirst({ where: { name: { equals: data.name, mode: "insensitive" }, id: { not: id } } });
    if (clash) throw new DomainError("conflict", "There is already a supplier with this name.", "name");
    const after = await tx.supplier.update({ where: { id }, data });
    const changes: string[] = [];
    if (before.active !== data.active) changes.push(data.active ? "switched on" : "switched off");
    if (before.preferred !== data.preferred) changes.push(data.preferred ? "marked preferred" : "no longer preferred");
    if (before.landedCostBps !== data.landedCostBps) changes.push(`landed cost allowance ${before.landedCostBps / 100}% to ${data.landedCostBps / 100}%`);
    if (before.leadTimeDays !== data.leadTimeDays) changes.push(`lead time ${before.leadTimeDays} to ${data.leadTimeDays} days`);
    if (before.currency !== data.currency) changes.push(`currency to ${data.currency}`);
    if (!changes.length) changes.push("details");
    await audit(tx, staffAudit(actor, { action: "supplier.updated", summary: `Changed ${before.name}: ${changes.join(", ")}`, targetType: "Supplier", targetId: id, ipAddress: ip }));
    return after;
  });
}

/** Removes a supplier with its offers and price lists. The audit log keeps the history. */
export async function removeSupplier(db: PrismaClient, actor: StaffActor, id: string, ip?: string | null) {
  assertStaffCan(actor, "manageSuppliers");
  await db.$transaction(async (tx) => {
    const s = await tx.supplier.findUnique({ where: { id }, include: { _count: { select: { offers: true } } } });
    if (!s) return;
    await tx.supplier.delete({ where: { id } });
    await audit(tx, staffAudit(actor, { action: "supplier.removed", summary: `Removed the supplier ${s.name} and its ${s._count.offers} offers`, targetType: "Supplier", targetId: id, ipAddress: ip }));
  });
}

export async function setSupplierCategories(db: PrismaClient, actor: StaffActor, id: string, categoryIds: string[], ip?: string | null) {
  assertStaffCan(actor, "manageSuppliers");
  await db.$transaction(async (tx) => {
    const s = await tx.supplier.findUnique({ where: { id } });
    if (!s) throw new DomainError("not-found", "No such supplier.");
    const found = await tx.category.findMany({ where: { id: { in: [...new Set(categoryIds)] } }, select: { id: true, name: true } });
    await tx.supplierCategory.deleteMany({ where: { supplierId: id } });
    if (found.length) await tx.supplierCategory.createMany({ data: found.map((c) => ({ supplierId: id, categoryId: c.id })) });
    await audit(tx, staffAudit(actor, { action: "supplier.categories", summary: `${s.name} supplies ${found.length ? found.map((c) => c.name).join(", ") : "no categories yet"}`, targetType: "Supplier", targetId: id, ipAddress: ip }));
  });
}

export interface ContactInput {
  name: string;
  role: string;
  email: string;
  phone: string;
  whatsapp: string;
}

export async function addContact(db: PrismaClient, actor: StaffActor, supplierId: string, input: ContactInput, ip?: string | null) {
  assertStaffCan(actor, "manageSuppliers");
  const name = input.name.trim();
  const role = input.role.trim();
  const email = input.email.trim().toLowerCase() || null;
  const phone = normalisePhone(input.phone) || null;
  const whatsapp = normalisePhone(input.whatsapp) || null;
  const fieldErrors: Record<string, string> = {};
  if (name.length < 2 || name.length > 100) fieldErrors.name = "Enter their name.";
  if (role.length > 60) fieldErrors.role = "Keep it under 60 characters.";
  if (email && !EMAIL.test(email)) fieldErrors.email = "Enter a valid email address.";
  if (phone && !PHONE.test(phone)) fieldErrors.phone = "Use the international format, like +27 11 000 0000.";
  if (whatsapp && !PHONE.test(whatsapp)) fieldErrors.whatsapp = "Use the international format, like +86 138 0000 0000.";
  if (!email && !phone && !whatsapp && !fieldErrors.name) fieldErrors.email = "Give at least one way to reach them.";
  if (Object.keys(fieldErrors).length) throw new DomainError("invalid", "Check the highlighted fields.", undefined, fieldErrors);
  await db.$transaction(async (tx) => {
    const s = await tx.supplier.findUnique({ where: { id: supplierId } });
    if (!s) throw new DomainError("not-found", "No such supplier.");
    await tx.supplierContact.create({ data: { supplierId, name, role, email, phone, whatsapp } });
    await audit(tx, staffAudit(actor, { action: "supplier.contact-added", summary: `Added ${name} as a contact at ${s.name}`, targetType: "Supplier", targetId: supplierId, ipAddress: ip }));
  });
}

export async function removeContact(db: PrismaClient, actor: StaffActor, id: string, ip?: string | null) {
  assertStaffCan(actor, "manageSuppliers");
  await db.$transaction(async (tx) => {
    const c = await tx.supplierContact.findUnique({ where: { id }, include: { supplier: true } });
    if (!c) return;
    await tx.supplierContact.delete({ where: { id } });
    await audit(tx, staffAudit(actor, { action: "supplier.contact-removed", summary: `Removed ${c.name} as a contact at ${c.supplier.name}`, targetType: "Supplier", targetId: c.supplierId, ipAddress: ip }));
  });
}

/** Adds to the performance record. Anyone who can read suppliers can record what happened. */
export async function recordEvent(db: PrismaClient, actor: StaffActor, supplierId: string, input: { kind: SupplierEventKind; occurredOn: string; note: string; reference: string }, ip?: string | null) {
  assertStaffCan(actor, "viewSuppliers");
  const note = input.note.trim();
  const reference = input.reference.trim() || null;
  const occurredAt = /^\d{4}-\d{2}-\d{2}$/.test(input.occurredOn) ? new Date(`${input.occurredOn}T12:00:00Z`) : new Date(NaN);
  const fieldErrors: Record<string, string> = {};
  if (!EVENT_KINDS.includes(input.kind)) fieldErrors.kind = "Choose what happened.";
  if (Number.isNaN(occurredAt.getTime()) || occurredAt.getTime() > Date.now() + 86_400_000) fieldErrors.occurredOn = "Enter the date it happened.";
  if (note.length > 1000) fieldErrors.note = "Keep it under 1,000 characters.";
  if (input.kind === "NOTE" && !note) fieldErrors.note = "Write the note.";
  if (reference && reference.length > 60) fieldErrors.reference = "Keep it under 60 characters.";
  if (Object.keys(fieldErrors).length) throw new DomainError("invalid", "Check the highlighted fields.", undefined, fieldErrors);
  await db.$transaction(async (tx) => {
    const s = await tx.supplier.findUnique({ where: { id: supplierId } });
    if (!s) throw new DomainError("not-found", "No such supplier.");
    await tx.supplierEvent.create({ data: { supplierId, kind: input.kind, occurredAt, note, reference, recordedById: actor.userId, recordedByLabel: actor.name } });
    await audit(tx, staffAudit(actor, { action: "supplier.event", summary: `Recorded for ${s.name}: ${EVENT_KIND_LABEL[input.kind]}`, targetType: "Supplier", targetId: supplierId, ipAddress: ip }));
  });
}

// ─── Offers ──────────────────────────────────────────────────────────

export interface OfferInput {
  supplierId: string;
  productId: string;
  cost: string;
  supplierSku: string;
  leadTimeDays: string;
  moq: string;
  stock: string;
  active: boolean;
}

/** Adds or changes what one supplier charges for one product, typed by staff. Costs are in the supplier's currency. */
export async function saveOffer(db: PrismaClient, actor: StaffActor, input: OfferInput, ip?: string | null, now = new Date()) {
  assertStaffCan(actor, "manageSuppliers");
  const supplier = await db.supplier.findUnique({ where: { id: input.supplierId } });
  if (!supplier) throw new DomainError("invalid", "Choose a supplier.", "supplierId");
  const fieldErrors: Record<string, string> = {};
  let costMinor = 0n;
  try {
    costMinor = parseMoney(input.cost, supplier.currency);
    if (costMinor <= 0n) throw new Error();
  } catch {
    fieldErrors.cost = `Enter their price in ${supplier.currency}.`;
  }
  const int = (v: string, key: string, min: number, label: string) => {
    if (!v.trim()) return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > 1_000_000) fieldErrors[key] = label;
    return n;
  };
  const leadTimeDays = int(input.leadTimeDays, "leadTimeDays", 0, "Enter whole days, or leave it empty for their usual.");
  const moq = int(input.moq, "moq", 1, "Enter a whole number from 1.") ?? 1;
  const stock = int(input.stock, "stock", 0, "Enter a whole number, or leave it empty.");
  const supplierSku = input.supplierSku.trim().slice(0, 80) || null;
  if (Object.keys(fieldErrors).length) throw new DomainError("invalid", "Check the highlighted fields.", undefined, fieldErrors);
  await db.$transaction(async (tx) => {
    const p = await tx.product.findUnique({ where: { id: input.productId }, select: { name: true } });
    if (!p) throw new DomainError("not-found", "No such product.");
    const before = await tx.supplierOffer.findUnique({ where: { supplierId_productId: { supplierId: supplier.id, productId: input.productId } } });
    const priceChanged = !before || before.costMinor !== costMinor || before.currency !== supplier.currency;
    await tx.supplierOffer.upsert({
      where: { supplierId_productId: { supplierId: supplier.id, productId: input.productId } },
      create: { supplierId: supplier.id, productId: input.productId, costMinor, currency: supplier.currency, leadTimeDays, moq, stock, supplierSku, active: input.active, source: "staff", priceUpdatedAt: now },
      update: { costMinor, currency: supplier.currency, leadTimeDays, moq, stock, supplierSku, active: input.active, source: "staff", ...(priceChanged ? { priceUpdatedAt: now } : {}) },
    });
    const price = `${supplier.currency} ${toPlainAmount({ amountMinor: costMinor, currency: supplier.currency })}`;
    await audit(
      tx,
      staffAudit(actor, {
        action: before ? "offer.updated" : "offer.added",
        summary: before ? `Changed ${supplier.name}'s offer for ${p.name}${priceChanged ? ` to ${price}` : ""}` : `Added ${supplier.name}'s offer for ${p.name} at ${price}`,
        targetType: "Product",
        targetId: input.productId,
        data: { supplierId: supplier.id, from: before ? before.costMinor.toString() : null, to: costMinor.toString(), currency: supplier.currency },
        ipAddress: ip,
      }),
    );
  });
}

export async function removeOffer(db: PrismaClient, actor: StaffActor, id: string, ip?: string | null) {
  assertStaffCan(actor, "manageSuppliers");
  await db.$transaction(async (tx) => {
    const o = await tx.supplierOffer.findUnique({ where: { id }, include: { supplier: true, product: true } });
    if (!o) return;
    await tx.supplierOffer.delete({ where: { id } });
    await audit(tx, staffAudit(actor, { action: "offer.removed", summary: `Removed ${o.supplier.name}'s offer for ${o.product.name}`, targetType: "Product", targetId: o.productId, ipAddress: ip }));
  });
}
