import type { Prisma, PrismaClient, QuoteStatus, Supplier } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { company } from "@/config/app";
import { formatMoney } from "@/lib/money";
import { agreedBeforeTax, fromMarket, marginBps, quoteTotals, quoteUnitPrice, reviewReasons } from "@/lib/quote-pricing";
import { chooseOffer, resolveRule, type OfferForChoice } from "@/lib/sourcing";
import { formatDate } from "@/lib/zoned";
import { creditPosition } from "@/server/accounts/credit";
import { audit, staffAudit, SYSTEM_ACTOR } from "@/server/audit";
import { seal } from "@/server/auth/secret-box";
import { hashToken, newToken } from "@/server/auth/tokens";
import { queueEmail } from "@/server/email/outbox";
import { DomainError } from "@/server/errors";
import { landedAdder, landedContext, type LandedContext } from "@/server/logistics/landed";
import { asRate, currentRates, pricingSettings } from "@/server/pricing/rates";
import { assertStaffCan, type StaffActor } from "@/server/staff/access";
import { DAY, HOUR, lineRef, quoteSettings, staffWhen, type QuoteDeps } from "./common";

/**
 * Turning read lines into a priced quote: catalogue prices first, then
 * requests for price to suppliers for the rest, then choosing the best
 * answer per line by the sourcing rules, adding the markup for the
 * request type and price level, converting, and checking the automation
 * rules. Inside the rules it is sent at once; outside them it waits in
 * the staff review queue with everything filled in.
 */

type Tx = Prisma.TransactionClient;

const CATEGORY_RULES = { select: { id: true, parentId: true, sourcingRule: true, parent: { select: { sourcingRule: true } } } } as const;

const LINE_INCLUDE = {
  product: { select: { id: true, sourcingRule: true, weightGrams: true, lengthMm: true, widthMm: true, heightMm: true, categoryId: true, category: CATEGORY_RULES, offers: { include: { supplier: true } } } },
  category: CATEGORY_RULES,
  responses: { include: { request: { include: { supplier: true } } } },
} satisfies Prisma.QuoteLineInclude;

type PricingLine = Prisma.QuoteLineGetPayload<{ include: typeof LINE_INCLUDE }>;

/** Can be priced now: still being worked on. */
const PRICEABLE: QuoteStatus[] = ["RECEIVED", "WAITING_ON_SUPPLIERS", "REVIEW"];

async function lock(tx: Tx, quoteId: string) {
  await tx.$queryRaw`SELECT id FROM "Quote" WHERE id = ${quoteId} FOR UPDATE`;
}

/** A supplier's answer, ranked alongside catalogue offers. Only usable while its price holds and they can supply the quantity. */
function responseOffer(r: PricingLine["responses"][number], quantity: number, today: Date): OfferForChoice & { responseId: string } {
  const valid = r.validUntil === null || r.validUntil.getTime() >= today.getTime();
  return {
    id: `response:${r.id}`,
    responseId: r.id,
    costMinor: r.costMinor ?? 0n,
    currency: r.currency,
    leadTimeDays: r.leadTimeDays,
    stock: r.available !== null && r.available < quantity ? 0 : r.available,
    active: !r.noOffer && r.costMinor !== null && valid,
    supplier: r.request.supplier,
  };
}

/** The best supplier for a line by its rule, from catalogue offers and suppliers' answers together. */
function bestCost(line: PricingLine, globalRule: Parameters<typeof resolveRule>[0], base: string, rate: (c: string) => ReturnType<typeof asRate>, today: Date, logistics: LandedContext) {
  const cat = line.product?.category ?? line.category;
  const rule = resolveRule(line.product?.sourcingRule, cat?.sourcingRule, cat?.parent?.sourcingRule, globalRule);
  const offers: (OfferForChoice & { responseId?: string })[] = [...(line.product?.offers ?? []), ...line.responses.map((r) => responseOffer(r, line.quantity, today))];
  // Freight and duty need the product's weight; lines without a product use the supplier's allowance.
  const adder = line.product ? landedAdder<OfferForChoice & { responseId?: string }>(logistics, { ...line.product, parentCategoryId: line.product.category.parentId }) : undefined;
  const chosen = chooseOffer(offers, rule, base, rate, adder).chosen;
  if (!chosen?.landed) return null;
  return { source: chosen.offer.responseId ? ("SUPPLIER" as const) : ("CATALOGUE" as const), supplierId: chosen.offer.supplier.id, cost: chosen.landed.amountMinor, lead: chosen.leadTimeDays };
}

// ─── Requests for price ──────────────────────────────────────────────

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newReference(): string {
  const bytes = randomBytes(6);
  return `RFQ-${Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("")}`;
}

/** Suppliers who could price a line: they have an offer for the product, or supply its category or the category above it, and we can reach them. */
async function suppliersFor(tx: Tx, line: PricingLine): Promise<Supplier[]> {
  const cat = line.product?.category ?? line.category;
  const categoryIds = [cat?.id, cat?.parentId].filter((x): x is string => Boolean(x));
  const or: Prisma.SupplierWhereInput[] = [];
  if (line.productId) or.push({ offers: { some: { productId: line.productId } } });
  if (categoryIds.length) or.push({ categories: { some: { categoryId: { in: categoryIds } } } });
  if (!or.length) return [];
  return tx.supplier.findMany({ where: { active: true, OR: or, AND: [{ OR: [{ email: { not: null } }, { whatsapp: { not: null } }] }] }, orderBy: { name: "asc" } });
}

/**
 * Sends a request for price to every matching supplier for the lines
 * that have no price yet, one request per supplier covering all the
 * lines it could price. Email goes out at once; WhatsApp waits for staff
 * to send the link by hand until the hub is live. Returns how many.
 */
async function askSuppliers(tx: Tx, deps: QuoteDeps, quote: { id: string; number: string; urgent: boolean; tenderDeadline: Date | null }, lines: PricingLine[], now: Date, onlyLineIds?: string[]) {
  const [settings, pricing] = await Promise.all([quoteSettings(tx), pricingSettings(tx)]);
  const rates = await currentRates(tx, pricing.baseCurrency);
  const rate = (c: string) => asRate(rates.get(c));
  const logistics = await landedContext(tx);
  const open = await tx.supplierPriceRequest.findMany({ where: { quoteId: quote.id, status: { in: ["SENT", "TO_SEND_BY_HAND"] } }, select: { supplierId: true, lineIds: true } });
  const asked = new Set(open.flatMap((r) => r.lineIds.map((l) => `${r.supplierId}:${l}`)));
  const bySupplier = new Map<string, { supplier: Supplier; lines: PricingLine[] }>();
  for (const line of lines) {
    if (onlyLineIds && !onlyLineIds.includes(line.id)) continue;
    if (line.flagReason || line.costSource === "STAFF" || line.priceOverride !== null) continue;
    if (!onlyLineIds && bestCost(line, pricing.sourcingRule, pricing.baseCurrency, rate, now, logistics)) continue;
    for (const s of await suppliersFor(tx, line)) {
      if (asked.has(`${s.id}:${line.id}`) || line.responses.some((r) => r.request.supplierId === s.id)) continue;
      const entry = bySupplier.get(s.id) ?? { supplier: s, lines: [] };
      entry.lines.push(line);
      bySupplier.set(s.id, entry);
    }
  }
  if (!bySupplier.size) return { count: 0, deadline: null };
  let deadline = new Date(now.getTime() + (quote.urgent ? settings.urgentSupplierHours : settings.supplierHours) * HOUR);
  // A tender needs a day after the suppliers answer for us to check and send it.
  if (quote.tenderDeadline && quote.tenderDeadline.getTime() - DAY < deadline.getTime()) deadline = new Date(Math.max(now.getTime() + HOUR, quote.tenderDeadline.getTime() - DAY));
  for (const { supplier, lines: theirs } of bySupplier.values()) {
    const token = newToken();
    let reference = newReference();
    while (await tx.supplierPriceRequest.findUnique({ where: { reference } })) reference = newReference();
    const byEmail = Boolean(supplier.email);
    await tx.supplierPriceRequest.create({
      data: { quoteId: quote.id, supplierId: supplier.id, reference, channel: byEmail ? "EMAIL" : "WHATSAPP", status: byEmail ? "SENT" : "TO_SEND_BY_HAND", lineIds: theirs.map((l) => l.id), tokenHash: hashToken(token), tokenSealed: seal(token, deps.key), deadline, sentAt: byEmail ? now : null },
    });
    if (byEmail) {
      await queueEmail(tx, deps.key, {
        to: supplier.email!,
        kind: "supplier.rfq",
        payload: { reference, supplier: supplier.name, currency: supplier.currency, deadline: staffWhen(deadline), lines: theirs.map((l) => `${lineRef(l.position)}: ${l.quantity} x ${l.description}${l.mpn ? ` (part ${l.mpn})` : ""}`).join("\n"), urgent: quote.urgent ? "yes" : "", replyTo: deps.replyTo ?? "" },
        secret: { token },
      });
    }
    await audit(tx, { ...SYSTEM_ACTOR, action: "quote.rfq-sent", summary: `Asked ${supplier.name} for prices on ${theirs.length} ${theirs.length === 1 ? "line" : "lines"} of quote ${quote.number} (${reference}), by ${byEmail ? "email" : "WhatsApp, to send by hand"}`, targetType: "Quote", targetId: quote.id });
  }
  return { count: bySupplier.size, deadline };
}

/**
 * After a quote is read: anything without a current price goes to the
 * suppliers who could price it. When nothing needs asking, it is priced
 * straight away.
 */
export async function startPricing(db: PrismaClient, deps: QuoteDeps, quoteId: string) {
  const now = deps.now ?? new Date();
  const waiting = await db.$transaction(async (tx) => {
    await lock(tx, quoteId);
    const q = await tx.quote.findUnique({ where: { id: quoteId }, include: { lines: { include: LINE_INCLUDE, orderBy: { position: "asc" } } } });
    if (!q || q.status !== "RECEIVED") return false;
    const { count, deadline } = await askSuppliers(tx, deps, q, q.lines, now);
    if (!count) return false;
    await tx.quote.update({ where: { id: quoteId }, data: { status: "WAITING_ON_SUPPLIERS", supplierDeadline: deadline } });
    return true;
  });
  if (!waiting) await priceQuote(db, deps, quoteId, { decide: true });
}

/** Staff: ask suppliers again for the lines that still have no price, or for the lines given. */
export async function requestPrices(db: PrismaClient, actor: StaffActor, deps: QuoteDeps, quoteId: string, ip?: string | null) {
  assertStaffCan(actor, "enterSupplierPrices");
  const now = deps.now ?? new Date();
  return db.$transaction(async (tx) => {
    await lock(tx, quoteId);
    const q = await tx.quote.findUnique({ where: { id: quoteId }, include: { lines: { include: LINE_INCLUDE, orderBy: { position: "asc" } } } });
    if (!q) throw new DomainError("not-found", "No such quote.");
    if (q.status !== "REVIEW" && q.status !== "WAITING_ON_SUPPLIERS") throw new DomainError("conflict", "Suppliers can only be asked while the quote is being prepared.");
    const unpriced = q.lines.filter((l) => l.unitCostBaseMinor === null && !l.flagReason && l.priceOverride === null).map((l) => l.id);
    if (!unpriced.length) throw new DomainError("invalid", "Every line has a cost already. Change a line first.");
    const { count, deadline } = await askSuppliers(tx, deps, q, q.lines, now, unpriced);
    if (!count) throw new DomainError("invalid", "No supplier we can reach supplies these lines. Add the category to a supplier, or enter a cost on the line.");
    await tx.quote.update({ where: { id: quoteId }, data: { status: "WAITING_ON_SUPPLIERS", supplierDeadline: deadline } });
    await audit(tx, staffAudit(actor, { action: "quote.rfq-requested", summary: `Asked ${count} ${count === 1 ? "supplier" : "suppliers"} for prices on quote ${q.number}`, targetType: "Quote", targetId: quoteId, ipAddress: ip }));
    return count;
  });
}

// ─── Pricing and deciding ────────────────────────────────────────────

/**
 * Works out every line's cost and price and the quote's totals. With
 * `decide`, a quote inside every automation rule is sent and anything
 * else goes to the review queue; without it (staff changing a quote in
 * review) the prices and reasons are only brought up to date.
 */
export async function priceQuote(db: PrismaClient, deps: QuoteDeps, quoteId: string, opts: { decide: boolean }): Promise<QuoteStatus | null> {
  const now = deps.now ?? new Date();
  return db.$transaction(async (tx) => {
    await lock(tx, quoteId);
    const q = await tx.quote.findUnique({ where: { id: quoteId }, include: { market: true, organisation: { select: { customerType: true, verification: true } }, lines: { include: LINE_INCLUDE, orderBy: { position: "asc" } } } });
    if (!q) return null;
    if (!PRICEABLE.includes(q.status)) return q.status;
    const [settings, pricing] = await Promise.all([quoteSettings(tx), pricingSettings(tx)]);
    const base = pricing.baseCurrency;
    const [rates, logistics] = await Promise.all([currentRates(tx, base), landedContext(tx)]);
    const rate = (c: string) => asRate(rates.get(c));
    const marketRate = q.currency === base ? null : rate(q.currency);
    const convertible = q.currency === base || marketRate !== null;
    const [level, categoryMarkups, agreed] = await Promise.all([
      tx.customerType.findUniqueOrThrow({ where: { code: q.customerType }, select: { markupBps: true } }),
      tx.categoryMarkup.findMany({ where: { customerType: q.customerType }, select: { categoryId: true, markupBps: true } }),
      q.organisationId && q.customerType !== "INDIVIDUAL"
        ? tx.customerPrice.findMany({ where: { organisationId: q.organisationId, marketCode: q.marketCode, OR: [{ validUntil: null }, { validUntil: { gt: now } }] }, select: { productId: true, priceMinor: true } })
        : [],
    ]);
    const markups = new Map(categoryMarkups.map((m) => [m.categoryId, m.markupBps]));
    const agreedPrice = new Map(agreed.map((a) => [a.productId, a.priceMinor]));
    const typeMarkup = q.type === "TENDER" ? settings.tenderMarkupBps : q.type === "RESELLER_PROJECT" ? settings.projectMarkupBps : null;
    const today = new Date(now.getTime() - (now.getTime() % DAY));

    const extra: string[] = [];
    if (!convertible) extra.push(`There is no exchange rate from ${base} to ${q.currency}, so nothing can be priced.`);
    let costTotal = 0n;
    let costKnown = true;
    let lead = 0;
    const priced: { position: number; description: string; productId: string | null; matchConfidence: number; flagReason: string | null; unitPriceMinor: bigint | null; lineTotalMinor: bigint | null }[] = [];
    for (const line of q.lines) {
      let cost = line.unitCostBaseMinor;
      let costSource = line.costSource;
      let supplierId = line.supplierId;
      let leadTimeDays = line.leadTimeDays;
      if (costSource !== "STAFF") {
        const best = bestCost(line, pricing.sourcingRule, base, rate, today, logistics);
        cost = best?.cost ?? null;
        costSource = best?.source ?? null;
        supplierId = best?.supplierId ?? null;
        leadTimeDays = best?.lead ?? null;
      }
      const cat = line.product?.category ?? line.category;
      const markup = typeMarkup ?? (cat ? (markups.get(cat.id) ?? (cat.parentId ? markups.get(cat.parentId) : undefined)) : undefined) ?? level.markupBps;
      let unit: bigint | null = null;
      if (line.priceOverride !== null) unit = line.priceOverride;
      else if (line.productId && agreedPrice.has(line.productId)) unit = agreedBeforeTax(agreedPrice.get(line.productId)!, q.market.taxRateBps);
      else if (cost !== null && convertible) unit = quoteUnitPrice({ amountMinor: cost, currency: base }, markup, q.market, marketRate).amountMinor;
      const total = unit === null ? null : unit * BigInt(line.quantity);
      if (unit !== null) {
        if (cost === null) {
          costKnown = false;
          extra.push(`Line ${line.position}: no cost, so its margin can't be checked.`);
        } else costTotal += cost * BigInt(line.quantity);
      }
      if (leadTimeDays !== null) lead = Math.max(lead, leadTimeDays);
      await tx.quoteLine.update({ where: { id: line.id }, data: { unitCostBaseMinor: cost, costSource, supplierId, leadTimeDays, unitPriceMinor: unit, lineTotalMinor: total } });
      priced.push({ position: line.position, description: line.description, productId: line.productId, matchConfidence: line.matchConfidence, flagReason: line.flagReason, unitPriceMinor: unit, lineTotalMinor: total });
    }
    const all = priced.every((l) => l.lineTotalMinor !== null) && priced.length > 0;
    const totals = quoteTotals(
      priced.map((l) => l.lineTotalMinor ?? 0n),
      q.market.taxRateBps,
    );
    const revenueBase = convertible ? fromMarket({ amountMinor: totals.subtotal, currency: q.currency }, base, marketRate).amountMinor : null;
    const margin = all && costKnown && revenueBase !== null ? marginBps(revenueBase, costTotal) : null;
    const reasons = [
      ...reviewReasons(settings, {
        lines: priced,
        subtotalBase: revenueBase,
        marginBps: margin,
        knownCustomer: Boolean(q.userId),
        maxValueText: formatMoney({ amountMinor: settings.maxAutoValueMinor, currency: base }, company.staffLocale),
        minMarginText: `${settings.minMarginBps / 100}%`,
      }),
      ...extra,
    ];
    const status: QuoteStatus = opts.decide ? (reasons.length ? "REVIEW" : "SENT") : q.status === "RECEIVED" ? "REVIEW" : q.status;
    await tx.quote.update({
      where: { id: quoteId },
      data: {
        subtotalMinor: all ? totals.subtotal : null,
        taxMinor: all ? totals.tax : null,
        totalMinor: all ? totals.total : null,
        taxName: q.market.taxName,
        taxRateBps: q.market.taxRateBps,
        costBaseMinor: costKnown ? costTotal : null,
        marginBps: margin,
        leadTimeDays: lead || null,
        reviewReasons: reasons.length ? reasons.join("\n") : null,
        pricedAt: now,
        status: status === "SENT" ? q.status : status,
      },
    });
    if (status === "SENT") {
      await sendInTx(tx, deps, quoteId, null, now);
      return "SENT";
    }
    if (status === "REVIEW" && q.status !== "REVIEW") await audit(tx, { ...SYSTEM_ACTOR, action: "quote.to-review", summary: `Quote ${q.number} is priced and waiting to be checked: ${reasons[0] ?? ""}`, targetType: "Quote", targetId: quoteId });
    return status;
  });
}

// ─── Sending ─────────────────────────────────────────────────────────

/** How the customer pays: on account when their credit is open, else by bank transfer before delivery. */
async function paymentTermsFor(tx: Tx, organisationId: string | null, now: Date): Promise<string> {
  if (organisationId) {
    const credit = await creditPosition(tx, organisationId, now);
    if (credit.open && credit.termsDays) return `On your account: pay within ${credit.termsDays} days of delivery, within your credit limit.`;
  }
  return "Pay in full by bank transfer before delivery, with the quote number as the reference.";
}

async function sendInTx(tx: Tx, deps: QuoteDeps, quoteId: string, actor: StaffActor | null, now: Date, ip?: string | null) {
  const q = await tx.quote.findUniqueOrThrow({ where: { id: quoteId }, include: { market: true, lines: true } });
  if (!q.lines.length || q.lines.some((l) => l.lineTotalMinor === null) || q.totalMinor === null) throw new DomainError("invalid", "Every line needs a price before the quote can go.");
  const settings = await quoteSettings(tx);
  const token = newToken();
  const validUntil = new Date(now.getTime() + settings.validityDays * DAY);
  const paymentTerms = await paymentTermsFor(tx, q.organisationId, now);
  await tx.quote.update({
    where: { id: quoteId },
    data: { status: "SENT", sentAt: now, sentByLabel: actor ? actor.name : "Automatically", validUntil, paymentTerms, bankDetails: q.market.bankDetails, accessTokenHash: hashToken(token), reviewReasons: actor ? q.reviewReasons : null },
  });
  await tx.supplierPriceRequest.updateMany({ where: { quoteId, status: { in: ["SENT", "TO_SEND_BY_HAND"] } }, data: { status: "CLOSED" } });
  const money = (n: bigint) => formatMoney({ amountMinor: n, currency: q.currency }, q.market.locale);
  await queueEmail(tx, deps.key, {
    to: q.email,
    kind: "quote.sent",
    payload: { number: q.number, name: q.name, total: money(q.totalMinor), taxName: q.taxName, validUntil: formatDate(validUntil, q.market.locale, q.market.timeZone), lines: String(q.lines.length), tender: q.tenderReference },
    secret: { token },
  });
  const summary = `Sent quote ${q.number} for ${money(q.totalMinor)}${actor ? "" : ", inside the automation rules"}`;
  await audit(
    tx,
    actor
      ? staffAudit(actor, { action: "quote.sent", summary, organisationId: q.organisationId, subjectUserId: q.userId, targetType: "Quote", targetId: quoteId, ipAddress: ip })
      : { ...SYSTEM_ACTOR, action: "quote.sent", summary, organisationId: q.organisationId, subjectUserId: q.userId, targetType: "Quote", targetId: quoteId, visibleToCustomer: Boolean(q.userId || q.organisationId) },
  );
}

/** Staff: send a quote from the review queue, as it is now. */
export async function sendQuote(db: PrismaClient, actor: StaffActor, deps: QuoteDeps, quoteId: string, ip?: string | null) {
  assertStaffCan(actor, "manageQuotes");
  await priceQuote(db, deps, quoteId, { decide: false });
  const now = deps.now ?? new Date();
  await db.$transaction(async (tx) => {
    await lock(tx, quoteId);
    const q = await tx.quote.findUnique({ where: { id: quoteId }, include: { lines: true } });
    if (!q) throw new DomainError("not-found", "No such quote.");
    if (q.status !== "REVIEW" && q.status !== "WAITING_ON_SUPPLIERS") throw new DomainError("conflict", "This quote has already been dealt with.");
    const flagged = q.lines.find((l) => l.flagReason);
    if (flagged) throw new DomainError("invalid", `Line ${flagged.position} is flagged: ${flagged.flagReason} Check it and save it first.`);
    await sendInTx(tx, deps, quoteId, actor, now, ip);
  });
}
