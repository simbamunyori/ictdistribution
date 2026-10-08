import type { Prisma, PrismaClient, QuoteStatus, QuoteType } from "@prisma/client";
import { company } from "@/config/app";
import { formatMoney, parseMoney, toPlainAmount } from "@/lib/money";
import { audit, staffAudit } from "@/server/audit";
import { queueEmail } from "@/server/email/outbox";
import { DomainError } from "@/server/errors";
import { pricingSettings } from "@/server/pricing/rates";
import { productByReference } from "@/server/shop/settings";
import { assertStaffCan, type StaffActor } from "@/server/staff/access";
import { OPEN_STATUSES, quoteSettings, type QuoteDeps } from "./common";
import { priceQuote } from "./pricing";

/**
 * The staff side: the queue of requests with their status and time
 * taken, and checking a quote in review: correcting lines, matching them
 * to products, typing a cost or a price, then sending it.
 */

export async function listQuotes(db: Pick<PrismaClient, "quote">, f: { status?: QuoteStatus; type?: QuoteType; q?: string } = {}) {
  const q = f.q?.trim();
  return db.quote.findMany({
    where: {
      ...(f.status ? { status: f.status } : {}),
      ...(f.type ? { type: f.type } : {}),
      ...(q ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { email: { contains: q.toLowerCase() } }, { name: { contains: q, mode: "insensitive" } }, { tenderReference: { contains: q, mode: "insensitive" } }, { organisation: { name: { contains: q, mode: "insensitive" } } }] } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { market: { select: { locale: true, name: true, timeZone: true } }, organisation: { select: { name: true } }, _count: { select: { lines: true } } },
  });
}

/** Counts for the admin menu: quotes to check, and WhatsApp requests to send by hand. */
export async function quotesWaiting(db: Pick<PrismaClient, "quote" | "supplierPriceRequest">) {
  const [review, byHand] = await Promise.all([db.quote.count({ where: { status: "REVIEW" } }), db.supplierPriceRequest.count({ where: { status: "TO_SEND_BY_HAND", quote: { status: { in: OPEN_STATUSES } } } })]);
  return { review, byHand };
}

export const STAFF_QUOTE_INCLUDE = {
  market: true,
  organisation: { select: { id: true, name: true, customerType: true, verification: true } },
  lines: {
    orderBy: { position: "asc" },
    include: {
      product: { select: { id: true, name: true, slug: true, mpn: true, warrantyMonths: true, warrantyTerms: true, brand: { select: { name: true } }, media: { where: { kind: "DATASHEET" }, select: { id: true, alt: true, filename: true }, orderBy: { sortOrder: "asc" } } } },
      category: { select: { id: true, name: true } },
      supplier: { select: { id: true, name: true } },
      responses: { include: { request: { select: { supplier: { select: { name: true } } } } } },
    },
  },
  priceRequests: { orderBy: { createdAt: "asc" }, include: { supplier: { select: { id: true, name: true, email: true, whatsapp: true, currency: true } }, responses: true } },
} satisfies Prisma.QuoteInclude;

export async function getQuote(db: Pick<PrismaClient, "quote">, id: string) {
  const q = await db.quote.findUnique({ where: { id }, include: STAFF_QUOTE_INCLUDE, omit: { file: true } });
  if (!q) throw new DomainError("not-found", "No such quote.");
  return q;
}

/** "2 h 10 min", "3 days 4 h": how long something took. */
export function durationText(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  const days = Math.floor(min / 1440);
  const hours = Math.floor((min % 1440) / 60);
  if (days) return `${days} ${days === 1 ? "day" : "days"}${hours ? ` ${hours} h` : ""}`;
  if (hours) return `${hours} h ${min % 60} min`;
  return `${Math.max(1, min)} min`;
}

// ─── Checking a quote ────────────────────────────────────────────────

const EDITABLE: QuoteStatus[] = ["WAITING_ON_SUPPLIERS", "REVIEW"];

export interface LineInput {
  description: string;
  quantity: string;
  /** Our product's part number or address. Empty: not a product we list. */
  reference: string;
  /** For a line we don't list: whose suppliers to ask. */
  categoryId: string;
  /** Our landed cost per unit in the base currency. Empty: from offers and supplier answers. */
  cost: string;
  leadTimeDays: string;
  /** The price per unit before tax in the quote's currency. Empty: worked out from the cost. */
  price: string;
}

async function lineValues(db: PrismaClient, quote: { currency: string }, input: LineInput) {
  const fieldErrors: Record<string, string> = {};
  const description = input.description.trim().replace(/\s+/g, " ");
  if (description.length < 2 || description.length > 300) fieldErrors.description = "Describe the item.";
  const quantity = Number(input.quantity.trim());
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100_000) fieldErrors.quantity = "Enter a whole number of units.";
  let product: { id: string; categoryId: string; mpn: string } | null = null;
  if (input.reference.trim()) {
    try {
      product = await productByReference(db, input.reference);
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      fieldErrors.reference = e.message;
    }
  }
  const categoryId = product?.categoryId ?? (input.categoryId || null);
  if (categoryId && !product && !(await db.category.findUnique({ where: { id: categoryId } }))) fieldErrors.categoryId = "Choose a category.";
  const base = (await pricingSettings(db)).baseCurrency;
  let cost: bigint | null = null;
  if (input.cost.trim()) {
    try {
      cost = parseMoney(input.cost, base);
      if (cost <= 0n) throw new Error();
    } catch {
      fieldErrors.cost = `Enter the landed cost per unit in ${base}.`;
    }
  }
  let lead: number | null = null;
  if (input.leadTimeDays.trim()) {
    lead = Number(input.leadTimeDays.trim());
    if (!Number.isInteger(lead) || lead < 0 || lead > 365) fieldErrors.leadTimeDays = "Enter days, up to 365.";
  }
  let price: bigint | null = null;
  if (input.price.trim()) {
    try {
      price = parseMoney(input.price, quote.currency);
      if (price <= 0n) throw new Error();
    } catch {
      fieldErrors.price = `Enter the price per unit before tax in ${quote.currency}.`;
    }
  }
  if (Object.keys(fieldErrors).length) throw new DomainError("invalid", "Check the highlighted fields.", undefined, fieldErrors);
  return {
    description,
    quantity,
    productId: product?.id ?? null,
    categoryId,
    mpn: product?.mpn ?? "",
    // A person chose it: as sure as an exact part number.
    matchConfidence: product ? 100 : 0,
    flagReason: null,
    ...(cost !== null ? { costSource: "STAFF" as const, unitCostBaseMinor: cost, supplierId: null, leadTimeDays: lead } : { costSource: null, unitCostBaseMinor: null, supplierId: null, leadTimeDays: null }),
    priceOverride: price,
  };
}

async function editableQuote(tx: Prisma.TransactionClient, quoteId: string) {
  await tx.$queryRaw`SELECT id FROM "Quote" WHERE id = ${quoteId} FOR UPDATE`;
  const q = await tx.quote.findUnique({ where: { id: quoteId } });
  if (!q) throw new DomainError("not-found", "No such quote.");
  if (!EDITABLE.includes(q.status)) throw new DomainError("conflict", "Only a quote being prepared can be changed.");
  return q;
}

/** Saves a checked line: it is no longer flagged, and the quote is priced again. */
export async function updateLine(db: PrismaClient, actor: StaffActor, deps: QuoteDeps, lineId: string, input: LineInput, ip?: string | null) {
  assertStaffCan(actor, "manageQuotes");
  const line = await db.quoteLine.findUnique({ where: { id: lineId }, include: { quote: true } });
  if (!line) throw new DomainError("not-found", "No such line.");
  const data = await lineValues(db, line.quote, input);
  await db.$transaction(async (tx) => {
    const q = await editableQuote(tx, line.quoteId);
    await tx.quoteLine.update({ where: { id: lineId }, data });
    await audit(tx, staffAudit(actor, { action: "quote.line-checked", summary: `Checked line ${line.position} of quote ${q.number}: ${data.quantity} x ${data.description}`, organisationId: q.organisationId, subjectUserId: q.userId, targetType: "Quote", targetId: q.id, ipAddress: ip }));
  });
  await priceQuote(db, deps, line.quoteId, { decide: false });
}

export async function addLine(db: PrismaClient, actor: StaffActor, deps: QuoteDeps, quoteId: string, input: LineInput, ip?: string | null) {
  assertStaffCan(actor, "manageQuotes");
  const quote = await db.quote.findUnique({ where: { id: quoteId } });
  if (!quote) throw new DomainError("not-found", "No such quote.");
  const data = await lineValues(db, quote, input);
  await db.$transaction(async (tx) => {
    const q = await editableQuote(tx, quoteId);
    const last = await tx.quoteLine.aggregate({ where: { quoteId }, _max: { position: true } });
    const position = (last._max.position ?? 0) + 1;
    await tx.quoteLine.create({ data: { ...data, quoteId, position, original: "Added by staff" } });
    await audit(tx, staffAudit(actor, { action: "quote.line-added", summary: `Added line ${position} to quote ${q.number}: ${data.quantity} x ${data.description}`, organisationId: q.organisationId, subjectUserId: q.userId, targetType: "Quote", targetId: q.id, ipAddress: ip }));
  });
  await priceQuote(db, deps, quoteId, { decide: false });
}

export async function removeLine(db: PrismaClient, actor: StaffActor, deps: QuoteDeps, lineId: string, ip?: string | null) {
  assertStaffCan(actor, "manageQuotes");
  const line = await db.quoteLine.findUnique({ where: { id: lineId } });
  if (!line) throw new DomainError("not-found", "No such line.");
  await db.$transaction(async (tx) => {
    const q = await editableQuote(tx, line.quoteId);
    await tx.quoteLine.delete({ where: { id: lineId } });
    await audit(tx, staffAudit(actor, { action: "quote.line-removed", summary: `Removed line ${line.position} from quote ${q.number}: ${line.description}`, organisationId: q.organisationId, subjectUserId: q.userId, targetType: "Quote", targetId: q.id, ipAddress: ip }));
  });
  await priceQuote(db, deps, line.quoteId, { decide: false });
}

/** Datasheets and warranty details with the quote, as tenders usually ask. */
export async function setIncludeDocuments(db: PrismaClient, actor: StaffActor, quoteId: string, include: boolean, ip?: string | null) {
  assertStaffCan(actor, "manageQuotes");
  await db.$transaction(async (tx) => {
    const q = await editableQuote(tx, quoteId);
    await tx.quote.update({ where: { id: quoteId }, data: { includeDocuments: include } });
    await audit(tx, staffAudit(actor, { action: "quote.documents", summary: `${include ? "Added" : "Removed"} datasheets and warranty details ${include ? "to" : "from"} quote ${q.number}`, organisationId: q.organisationId, subjectUserId: q.userId, targetType: "Quote", targetId: q.id, ipAddress: ip }));
  });
}

/** Staff: price it again now, for example after a change to an offer or a rate. */
export async function repriceQuote(db: PrismaClient, actor: StaffActor, deps: QuoteDeps, quoteId: string) {
  assertStaffCan(actor, "manageQuotes");
  await priceQuote(db, deps, quoteId, { decide: false });
}

export async function cancelQuote(db: PrismaClient, actor: StaffActor, deps: QuoteDeps, quoteId: string, reasonInput: string, ip?: string | null) {
  assertStaffCan(actor, "manageQuotes");
  const reason = reasonInput.trim().slice(0, 300);
  if (reason.length < 3) throw new DomainError("invalid", "Say why, for the customer.", "reason");
  const now = deps.now ?? new Date();
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Quote" WHERE id = ${quoteId} FOR UPDATE`;
    const q = await tx.quote.findUnique({ where: { id: quoteId } });
    if (!q) throw new DomainError("not-found", "No such quote.");
    if (![...OPEN_STATUSES, "SENT"].includes(q.status)) throw new DomainError("conflict", "This quote can't be cancelled now.");
    await tx.quote.update({ where: { id: quoteId }, data: { status: "CANCELLED", cancelledAt: now } });
    await tx.supplierPriceRequest.updateMany({ where: { quoteId, status: { in: ["SENT", "TO_SEND_BY_HAND"] } }, data: { status: "CLOSED" } });
    await queueEmail(tx, deps.key, { to: q.email, kind: "quote.cancelled", payload: { number: q.number, name: q.name, reason } });
    await audit(tx, staffAudit(actor, { action: "quote.cancelled", summary: `Cancelled quote ${q.number}: ${reason}`, organisationId: q.organisationId, subjectUserId: q.userId, targetType: "Quote", targetId: q.id, ipAddress: ip }));
  });
}

// ─── Rules ───────────────────────────────────────────────────────────

export interface RulesInput {
  automationEnabled: boolean;
  maxAutoValue: string;
  minMarginPercent: string;
  minMatchConfidence: string;
  supplierHours: string;
  urgentSupplierHours: string;
  validityDays: string;
  tenderMarkupPercent: string;
  projectMarkupPercent: string;
  tenderReminderHours: string;
}

/** The rules as the form shows them. */
export async function rulesForm(db: PrismaClient) {
  const [s, base] = await Promise.all([quoteSettings(db), pricingSettings(db).then((p) => p.baseCurrency)]);
  const pct = (bps: number | null) => (bps === null ? "" : String(bps / 100));
  return {
    base,
    values: {
      automationEnabled: s.automationEnabled,
      maxAutoValue: toPlainAmount({ amountMinor: s.maxAutoValueMinor, currency: base }),
      minMarginPercent: pct(s.minMarginBps),
      minMatchConfidence: String(s.minMatchConfidence),
      supplierHours: String(s.supplierHours),
      urgentSupplierHours: String(s.urgentSupplierHours),
      validityDays: String(s.validityDays),
      tenderMarkupPercent: pct(s.tenderMarkupBps),
      projectMarkupPercent: pct(s.projectMarkupBps),
      tenderReminderHours: String(s.tenderReminderHours),
    },
  };
}

export async function updateQuoteRules(db: PrismaClient, actor: StaffActor, input: RulesInput, ip?: string | null) {
  assertStaffCan(actor, "manageQuoteRules");
  const base = (await pricingSettings(db)).baseCurrency;
  const fieldErrors: Record<string, string> = {};
  const whole = (key: keyof RulesInput, min: number, max: number, message: string) => {
    const n = Number(String(input[key]).trim());
    if (!String(input[key]).trim() || !Number.isInteger(n) || n < min || n > max) fieldErrors[key] = message;
    return n;
  };
  const percent = (key: keyof RulesInput, optional: boolean) => {
    const t = String(input[key]).trim().replace(/%$/, "");
    if (!t && optional) return null;
    const n = Number(t);
    if (!t || !Number.isFinite(n) || n < 0 || n > 500) {
      fieldErrors[key] = "Enter a percentage from 0 to 500.";
      return 0;
    }
    return Math.round(n * 100);
  };
  let maxAutoValueMinor = 0n;
  try {
    maxAutoValueMinor = parseMoney(input.maxAutoValue, base);
    if (maxAutoValueMinor < 0n) throw new Error();
  } catch {
    fieldErrors.maxAutoValue = `Enter an amount in ${base}.`;
  }
  const data = {
    automationEnabled: input.automationEnabled,
    maxAutoValueMinor,
    minMarginBps: percent("minMarginPercent", false)!,
    minMatchConfidence: whole("minMatchConfidence", 0, 100, "Enter a number from 0 to 100."),
    supplierHours: whole("supplierHours", 1, 720, "Enter hours, from 1 to 720."),
    urgentSupplierHours: whole("urgentSupplierHours", 1, 720, "Enter hours, from 1 to 720."),
    validityDays: whole("validityDays", 1, 120, "Enter days, from 1 to 120."),
    tenderMarkupBps: percent("tenderMarkupPercent", true),
    projectMarkupBps: percent("projectMarkupPercent", true),
    tenderReminderHours: whole("tenderReminderHours", 1, 720, "Enter hours, from 1 to 720."),
  };
  if (!fieldErrors.urgentSupplierHours && !fieldErrors.supplierHours && data.urgentSupplierHours > data.supplierHours) fieldErrors.urgentSupplierHours = "Urgent requests can't give suppliers longer than others.";
  if (Object.keys(fieldErrors).length) throw new DomainError("invalid", "Check the highlighted fields.", undefined, fieldErrors);
  await db.$transaction(async (tx) => {
    await tx.quoteSettings.upsert({ where: { id: "global" }, create: { id: "global", ...data }, update: data });
    const money = formatMoney({ amountMinor: maxAutoValueMinor, currency: base }, company.staffLocale);
    await audit(tx, staffAudit(actor, { action: "quote.rules", summary: `Changed the quote rules: automatic sending ${data.automationEnabled ? "on" : "off"}, up to ${money}, margin at least ${data.minMarginBps / 100}%, matches at least ${data.minMatchConfidence}`, ipAddress: ip, data: { ...data, maxAutoValueMinor: maxAutoValueMinor.toString() } }));
  });
}
