import type { Fulfilment, Market, Order, OrderStatus, OrgRole, PaymentMethod, Prisma, PrismaClient, Quote, QuoteLine, SupplierPriceRequest, SupplierQuoteResponse } from "@prisma/client";
import { formatMoney, parseMoney, type Money } from "@/lib/money";
import { deliveryFee, taxIncluded } from "@/lib/shop-pricing";
import { formatDate } from "@/lib/zoned";
import { creditPosition, reserveCredit, type CreditPosition } from "@/server/accounts/credit";
import { audit, staffAudit, SYSTEM_ACTOR } from "@/server/audit";
import { hashToken, newToken } from "@/server/auth/tokens";
import { queueEmail } from "@/server/email/outbox";
import { DomainError } from "@/server/errors";
import { can } from "@/server/org/access";
import { cancelUnsentFor } from "@/server/procurement/purchase-orders";
import { advanceLines } from "@/server/logistics/tracking";
import { issueInvoice } from "@/server/portal/invoices";
import { orderMoney } from "@/server/aftersales/credit-notes";
import { syncUnits } from "@/server/aftersales/units";
import { issueForDelivery, releaseForOrder } from "@/server/logistics/stock";
import { assertStaffCan, type StaffActor } from "@/server/staff/access";
import { cartLines, priceLines, subtotal, type PricedLine } from "./cart";
import type { PriceContext } from "./prices";

/**
 * Orders from the shop. Prices are worked out again when the order is
 * placed and kept on its lines, so later changes never alter an order.
 * Bank transfer is the payment method until a card gateway is live:
 * the order waits for payment (ShopSettings.payDays), Finance records the
 * money when it arrives, and unpaid orders are cancelled by a job.
 * Businesses with credit can buy on account instead: the order goes ahead
 * at once and is due by its terms.
 */

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = { AWAITING_PAYMENT: "Waiting for payment", PAID: "Paid", ON_ACCOUNT: "On account", FULFILLED: "Sent or ready", CANCELLED: "Cancelled" };
export const PAYMENT_LABEL: Record<PaymentMethod, string> = { BANK_TRANSFER: "Bank transfer", CARD: "Card", ACCOUNT: "On account" };

/** Orders waiting to be sent or made ready: paid, or bought on account. */
export const TO_SEND: OrderStatus[] = ["PAID", "ON_ACCOUNT"];

/** What the customer reads for the order's state, depending on how it reaches them. */
export function orderStateText(o: Pick<Order, "status" | "fulfilment">): string {
  if (o.status === "FULFILLED") return o.fulfilment === "COLLECTION" ? "Ready to collect" : "Sent";
  if (o.status === "PAID") return o.fulfilment === "COLLECTION" ? "Paid, being prepared for collection" : "Paid, being prepared for delivery";
  if (o.status === "ON_ACCOUNT") return o.fulfilment === "COLLECTION" ? "On account, being prepared for collection" : "On account, being prepared for delivery";
  return ORDER_STATUS_LABEL[o.status];
}

export interface CheckoutInput {
  email: string;
  name: string;
  phone: string;
  fulfilment: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  postalCode: string;
  collectionPointId: string;
  paymentMethod: string;
  /** The buyer's own reference, such as a purchase order number. */
  customerReference?: string;
  notes: string;
}

export interface Buyer {
  userId: string | null;
  organisationId: string | null;
  /** Their role in the organisation, when buying for one. */
  role?: OrgRole | null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9]{7,15}$/;

function checkInput(input: CheckoutInput) {
  const fieldErrors: Record<string, string> = {};
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim().replace(/\s+/g, " ");
  const phone = input.phone.replace(/[\s()-]/g, "");
  if (!EMAIL.test(email) || email.length > 254) fieldErrors.email = "Enter your email address.";
  if (name.length < 2 || name.length > 120) fieldErrors.name = "Enter your name.";
  if (!PHONE.test(phone)) fieldErrors.phone = "Enter a phone number we can call, like +267 71 234 567.";
  const fulfilment = input.fulfilment as Fulfilment;
  if (fulfilment !== "DELIVERY" && fulfilment !== "COLLECTION") fieldErrors.fulfilment = "Choose delivery or collection.";
  const address = { addressLine1: input.addressLine1.trim(), addressLine2: input.addressLine2.trim(), city: input.city.trim(), postalCode: input.postalCode.trim() };
  if (fulfilment === "DELIVERY") {
    if (address.addressLine1.length < 3 || address.addressLine1.length > 120) fieldErrors.addressLine1 = "Enter the street address or plot number.";
    if (address.addressLine2.length > 120) fieldErrors.addressLine2 = "Keep it under 120 characters.";
    if (address.city.length < 2 || address.city.length > 60) fieldErrors.city = "Enter the town or city.";
    if (address.postalCode.length > 12) fieldErrors.postalCode = "Keep it under 12 characters.";
  }
  if (fulfilment === "COLLECTION" && !input.collectionPointId) fieldErrors.collectionPointId = "Choose where to collect it.";
  const paymentMethod = input.paymentMethod as PaymentMethod;
  if (paymentMethod !== "BANK_TRANSFER" && paymentMethod !== "CARD" && paymentMethod !== "ACCOUNT") fieldErrors.paymentMethod = "Choose how to pay.";
  const notes = input.notes.trim();
  if (notes.length > 500) fieldErrors.notes = "Keep it under 500 characters.";
  const customerReference = (input.customerReference ?? "").trim();
  if (customerReference.length > 60) fieldErrors.customerReference = "Keep it under 60 characters.";
  if (Object.keys(fieldErrors).length) throw new DomainError("invalid", "Check the highlighted fields.", undefined, fieldErrors);
  return { email, name, phone, fulfilment, paymentMethod, notes, customerReference, ...(fulfilment === "DELIVERY" ? address : { addressLine1: "", addressLine2: "", city: "", postalCode: "" }) };
}

/** What delivery, collection and payment a market (and the buyer's credit) offers, for the checkout form. */
export async function checkoutOptions(db: Pick<PrismaClient, "market" | "collectionPoint" | "organisation" | "$queryRaw">, marketCode: string, organisationId: string | null = null) {
  const market = await db.market.findUniqueOrThrow({ where: { code: marketCode } });
  const points = await db.collectionPoint.findMany({ where: { marketCode, active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  const account: CreditPosition | null = organisationId ? await creditPosition(db, organisationId) : null;
  return { market, points, bankTransfer: market.bankDetails.trim() !== "", card: false, account: account?.open ? account : null };
}

export interface OrderDeps {
  key: string;
  now?: Date;
}

export interface Totals {
  subtotal: Money;
  delivery: Money | null;
  total: Money;
  tax: Money;
}

export function totalsFor(lines: PricedLine[], market: { currency: string; taxRateBps: number; deliveryEnabled: boolean; deliveryFeeMinor: bigint; freeDeliveryMinor: bigint | null }, fulfilment: Fulfilment | null): Totals {
  const sub = subtotal(lines, market.currency);
  const fee = fulfilment === "COLLECTION" ? 0n : deliveryFee(sub.amountMinor, market);
  const total = sub.amountMinor + (fulfilment === "DELIVERY" ? (fee ?? 0n) : 0n);
  return { subtotal: sub, delivery: fee === null ? null : { amountMinor: fee, currency: market.currency }, total: { amountMinor: total, currency: market.currency }, tax: { amountMinor: taxIncluded(total, market.taxRateBps), currency: market.currency } };
}

/**
 * Places an order from a cart: prices it again, takes the special units
 * it uses (refusing if one has just sold out), writes the order and
 * empties the cart, all in one transaction, and queues the confirmation.
 * Returns the order and the secret for its link.
 */
export async function placeOrder(db: PrismaClient, deps: OrderDeps, cartId: string, ctx: PriceContext, buyer: Buyer, input: CheckoutInput) {
  const now = deps.now ?? new Date();
  const v = checkInput(input);
  if (buyer.organisationId && !(buyer.role && can({ role: buyer.role }, "buy"))) throw new DomainError("forbidden", "Your role in this organisation doesn't allow ordering. Ask an Owner or a Buyer.");
  const { market, points, bankTransfer } = await checkoutOptions(db, ctx.market.code);
  const items = await cartLines(db, cartId);
  if (!items.length) throw new DomainError("invalid", "Your cart is empty.");
  const lines = await priceLines(db, items, ctx);
  const problem = lines.find((l) => l.problem);
  if (problem) throw new DomainError("conflict", `${problem.name}: ${problem.problem} Check your cart.`);
  let collectionText = "";
  if (v.fulfilment === "DELIVERY" && !market.deliveryEnabled) throw new DomainError("invalid", `We don't deliver in ${market.name} yet. Choose collection.`, "fulfilment");
  if (v.fulfilment === "COLLECTION") {
    const point = points.find((p) => p.id === input.collectionPointId);
    if (!point) throw new DomainError("invalid", "Choose where to collect it.", "collectionPointId");
    collectionText = [point.name, point.address, point.hours].filter(Boolean).join("\n");
  }
  if (v.paymentMethod === "CARD") throw new DomainError("invalid", "Card payments aren't available yet. Choose bank transfer.", "paymentMethod");
  if (v.paymentMethod === "BANK_TRANSFER" && !bankTransfer) throw new DomainError("invalid", `Bank transfer isn't set up for ${market.name} yet. Contact us to order.`, "paymentMethod");
  if (v.paymentMethod === "ACCOUNT" && !buyer.organisationId) throw new DomainError("invalid", "Buying on account is for business accounts with credit.", "paymentMethod");
  const totals = totalsFor(lines, market, v.fulfilment);
  const settings = await db.shopSettings.findUniqueOrThrow({ where: { id: "global" } });
  const token = newToken();
  const payBy = new Date(now.getTime() + settings.payDays * 24 * 60 * 60 * 1000);

  const order = await db.$transaction(async (tx) => {
    const onAccount = v.paymentMethod === "ACCOUNT";
    const termsDays = onAccount ? await reserveCredit(tx, buyer.organisationId!, totals.total.amountMinor, now) : null;
    const take = new Map<string, { units: number; name: string }>();
    for (const l of lines) if (l.special && l.specialUnits) take.set(l.special.id, { units: (take.get(l.special.id)?.units ?? 0) + l.specialUnits, name: l.special.name });
    for (const [id, t] of take) {
      const n = await tx.$executeRaw`UPDATE "Special" SET "quantityUsed" = "quantityUsed" + ${t.units} WHERE "id" = ${id} AND ("quantityLimit" IS NULL OR "quantityUsed" + ${t.units} <= "quantityLimit")`;
      if (n !== 1) throw new DomainError("conflict", `${t.name} has just sold out. Your cart now shows the price without it.`);
    }
    const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('order_number_seq') AS n`;
    const created = await tx.order.create({
      data: {
        number: `${settings.orderPrefix}-${n}`,
        status: onAccount ? "ON_ACCOUNT" : "AWAITING_PAYMENT",
        marketCode: market.code,
        currency: market.currency,
        customerType: ctx.customerType,
        userId: buyer.userId,
        organisationId: buyer.organisationId,
        email: v.email,
        name: v.name,
        phone: v.phone,
        fulfilment: v.fulfilment,
        addressLine1: v.addressLine1,
        addressLine2: v.addressLine2,
        city: v.city,
        postalCode: v.postalCode,
        collectionPointId: v.fulfilment === "COLLECTION" ? input.collectionPointId : null,
        collectionText,
        paymentMethod: v.paymentMethod,
        bankDetails: v.paymentMethod === "CARD" ? "" : market.bankDetails,
        notes: v.notes,
        customerReference: v.customerReference,
        subtotalMinor: totals.subtotal.amountMinor,
        deliveryMinor: v.fulfilment === "DELIVERY" ? (totals.delivery?.amountMinor ?? 0n) : 0n,
        totalMinor: totals.total.amountMinor,
        taxMinor: totals.tax.amountMinor,
        taxName: market.taxName,
        taxRateBps: market.taxRateBps,
        accessTokenHash: hashToken(token),
        payBy: onAccount ? new Date(now.getTime() + termsDays! * 24 * 60 * 60 * 1000) : v.paymentMethod === "BANK_TRANSFER" ? payBy : null,
        lines: {
          create: lines.map((l, i) => {
            const special = l.special && l.specialUnits === l.quantity;
            const unit = l.total!.amountMinor / BigInt(l.quantity);
            return {
              productId: l.productId,
              bundleId: l.bundleId,
              description: l.kind === "bundle" ? `${l.name}: ${l.contents.map((c) => `${c.quantity} x ${c.name}`).join(", ")}` : `${l.brand} ${l.name}`.trim(),
              mpn: l.mpn,
              quantity: l.quantity,
              // A line partly at a special price keeps the average; the total is exact.
              unitPriceMinor: special ? l.specialUnit!.amountMinor : unit,
              listUnitPriceMinor: l.special ? (l.usualUnit?.amountMinor ?? null) : null,
              lineTotalMinor: l.total!.amountMinor,
              specialId: l.special?.id ?? null,
              specialName: l.special?.name ?? null,
              specialUnits: l.specialUnits,
              unitCostBaseMinor: l.unitCostBase,
              sortOrder: i,
            };
          }),
        },
      },
    });
    await tx.cartLine.deleteMany({ where: { cartId } });
    await queueEmail(tx, deps.key, { to: v.email, kind: "order.placed", payload: orderEmailPayload(created, market, lines), secret: { token } });
    await audit(tx, {
      actorKind: buyer.userId ? "CUSTOMER" : "SYSTEM",
      actorUserId: buyer.userId,
      actorLabel: buyer.userId ? v.name : `Guest ${v.email}`,
      action: "order.placed",
      summary: `Order ${created.number} placed for ${formatMoney(totals.total, market.locale)}`,
      organisationId: buyer.organisationId,
      subjectUserId: buyer.userId,
      targetType: "Order",
      targetId: created.id,
      visibleToCustomer: Boolean(buyer.userId || buyer.organisationId),
    });
    return created;
  });
  return { order, token };
}

export function orderEmailPayload(o: Order, market: { locale: string; timeZone: string }, lines?: PricedLine[]): Record<string, string> {
  const m = (amountMinor: bigint) => formatMoney({ amountMinor, currency: o.currency }, market.locale);
  return {
    number: o.number,
    name: o.name,
    total: m(o.totalMinor),
    method: o.paymentMethod,
    fulfilment: o.fulfilment,
    bankDetails: o.bankDetails,
    payBy: o.payBy ? formatDate(o.payBy, market.locale, market.timeZone) : "",
    lines: lines ? lines.map((l) => `${l.quantity} x ${l.name}: ${l.total ? m(l.total.amountMinor) : ""}`).join("\n") : "",
    collection: o.collectionText,
    address: [o.addressLine1, o.addressLine2, o.city, o.postalCode].filter(Boolean).join(", "),
    customerReference: o.customerReference,
  };
}

// ─── Orders from accepted quotes ─────────────────────────────────────

/** How the customer wants an accepted quote delivered and paid. */
export interface QuoteOrderDetails {
  phone: string;
  fulfilment: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  postalCode: string;
  collectionPointId: string;
  paymentMethod: string;
  notes: string;
}

type QuoteForOrder = Quote & { market: Market; lines: (QuoteLine & { responses: (SupplierQuoteResponse & { request: Pick<SupplierPriceRequest, "supplierId"> })[] })[] };

/**
 * Turns an accepted quote into an order, inside the acceptance's
 * transaction: its lines and prices exactly as quoted (before tax, with
 * the tax on the total), delivered as quoted, paid by bank transfer
 * against the pro forma invoice or on account within the credit limit.
 * Each line keeps the supplier and price agreed when quoting, for its
 * purchase order.
 */
export async function orderFromQuote(tx: Prisma.TransactionClient, deps: OrderDeps, q: QuoteForOrder, details: QuoteOrderDetails, now: Date) {
  const v = checkInput({ ...details, email: q.email, name: q.name, customerReference: (q.customerReference || q.tenderReference).slice(0, 60) });
  if (q.subtotalMinor === null || q.taxMinor === null || q.totalMinor === null) throw new DomainError("conflict", "This quote has no prices yet.");
  let collectionText = "";
  if (v.fulfilment === "COLLECTION") {
    const point = await tx.collectionPoint.findFirst({ where: { id: details.collectionPointId, marketCode: q.marketCode, active: true } });
    if (!point) throw new DomainError("invalid", "Choose where to collect it.", undefined, { collectionPointId: "Choose where to collect it." });
    collectionText = [point.name, point.address, point.hours].filter(Boolean).join("\n");
  }
  if (v.paymentMethod === "CARD") throw new DomainError("invalid", "Card payments aren't available yet. Choose bank transfer.", undefined, { paymentMethod: "Choose bank transfer." });
  if (v.paymentMethod === "ACCOUNT" && !q.organisationId) throw new DomainError("invalid", "Buying on account is for business accounts with credit.", undefined, { paymentMethod: "Choose bank transfer." });
  if (v.paymentMethod === "BANK_TRANSFER" && !q.market.bankDetails.trim()) throw new DomainError("invalid", `Bank transfer isn't set up for ${q.market.name} yet. Reply to the quote email and we will arrange payment.`, undefined, { paymentMethod: "Not available yet." });
  const onAccount = v.paymentMethod === "ACCOUNT";
  let termsDays: number | null = null;
  if (onAccount) {
    try {
      termsDays = await reserveCredit(tx, q.organisationId!, q.totalMinor, now);
    } catch (e) {
      if (e instanceof DomainError && e.field) throw new DomainError("invalid", e.message, undefined, { [e.field]: e.message });
      throw e;
    }
  }
  const settings = await tx.shopSettings.findUniqueOrThrow({ where: { id: "global" } });
  const lines = [];
  for (const l of q.lines) {
    if (l.unitPriceMinor === null || l.lineTotalMinor === null) continue;
    let supplierCostMinor: bigint | null = null;
    let supplierCurrency: string | null = null;
    if (l.supplierId && l.costSource === "SUPPLIER") {
      const r = l.responses.find((x) => x.request.supplierId === l.supplierId && !x.noOffer && x.costMinor !== null);
      if (r) [supplierCostMinor, supplierCurrency] = [r.costMinor, r.currency];
    } else if (l.supplierId && l.productId) {
      const offer = await tx.supplierOffer.findUnique({ where: { supplierId_productId: { supplierId: l.supplierId, productId: l.productId } } });
      if (offer) [supplierCostMinor, supplierCurrency] = [offer.costMinor, offer.currency];
    }
    lines.push({
      productId: l.productId,
      description: l.description,
      mpn: l.mpn,
      quantity: l.quantity,
      unitPriceMinor: l.unitPriceMinor,
      lineTotalMinor: l.lineTotalMinor,
      unitCostBaseMinor: l.unitCostBaseMinor,
      supplierId: supplierCostMinor === null ? null : l.supplierId,
      supplierCostMinor,
      supplierCurrency,
      sortOrder: l.position,
    });
  }
  if (!lines.length) throw new DomainError("conflict", "This quote has no priced lines.");
  const token = newToken();
  const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('order_number_seq') AS n`;
  const order = await tx.order.create({
    data: {
      number: `${settings.orderPrefix}-${n}`,
      status: onAccount ? "ON_ACCOUNT" : "AWAITING_PAYMENT",
      marketCode: q.marketCode,
      currency: q.currency,
      customerType: q.customerType,
      userId: q.userId,
      organisationId: q.organisationId,
      email: v.email,
      name: v.name,
      phone: v.phone,
      fulfilment: v.fulfilment,
      addressLine1: v.addressLine1,
      addressLine2: v.addressLine2,
      city: v.city,
      postalCode: v.postalCode,
      collectionPointId: v.fulfilment === "COLLECTION" ? details.collectionPointId : null,
      collectionText,
      quoteId: q.id,
      pricesIncludeTax: false,
      paymentMethod: v.paymentMethod,
      bankDetails: q.market.bankDetails,
      notes: v.notes,
      customerReference: v.customerReference,
      subtotalMinor: q.subtotalMinor,
      deliveryMinor: 0n,
      totalMinor: q.totalMinor,
      taxMinor: q.taxMinor,
      taxName: q.taxName,
      taxRateBps: q.taxRateBps,
      accessTokenHash: hashToken(token),
      payBy: new Date(now.getTime() + (termsDays ?? settings.payDays) * 24 * 60 * 60 * 1000),
      lines: { create: lines },
    },
  });
  const m = (amountMinor: bigint) => formatMoney({ amountMinor, currency: q.currency }, q.market.locale);
  await queueEmail(tx, deps.key, { to: v.email, kind: "order.placed", payload: { ...orderEmailPayload(order, q.market), lines: q.lines.filter((l) => l.lineTotalMinor !== null).map((l) => `${l.quantity} x ${l.description}: ${m(l.lineTotalMinor!)} before ${q.taxName}`).join("\n"), quote: q.number }, secret: { token } });
  return { order, token };
}

// ─── Reading ─────────────────────────────────────────────────────────

const ORDER_INCLUDE = { lines: { orderBy: { sortOrder: "asc" } }, payments: { orderBy: { receivedOn: "asc" } }, market: true } satisfies Prisma.OrderInclude;

/** An order for whoever holds its link. */
export async function orderByToken(db: Pick<PrismaClient, "order">, number: string, token: string) {
  const o = await db.order.findUnique({ where: { number }, include: ORDER_INCLUDE });
  if (!o || !token || o.accessTokenHash !== hashToken(token)) return null;
  return o;
}

/** A signed-in customer's own order: theirs, or their organisation's. */
export async function orderForCustomer(db: Pick<PrismaClient, "order">, number: string, buyer: Buyer) {
  const o = await db.order.findUnique({ where: { number }, include: ORDER_INCLUDE });
  if (!o) return null;
  const mine = (buyer.userId && o.userId === buyer.userId) || (buyer.organisationId && o.organisationId === buyer.organisationId);
  return mine ? o : null;
}

/**
 * A signed-in customer's orders: their organisation's, by anyone on the
 * team, when buying for one; else their own. `filter` narrows them to a
 * state, or to the orders the person placed themselves.
 */
export async function customerOrders(db: Pick<PrismaClient, "order">, buyer: Buyer, filter: { state?: "open" | "pay" | "sent" | "cancelled"; mine?: boolean } = {}) {
  if (!buyer.userId && !buyer.organisationId) return [];
  const scope: Prisma.OrderWhereInput = buyer.organisationId ? { organisationId: buyer.organisationId } : { userId: buyer.userId, organisationId: null };
  const states: Record<string, Prisma.OrderWhereInput> = { open: { status: { in: TO_SEND } }, pay: { status: "AWAITING_PAYMENT" }, sent: { status: "FULFILLED" }, cancelled: { status: "CANCELLED" } };
  return db.order.findMany({
    where: { ...scope, ...(filter.state ? states[filter.state] : {}), ...(filter.mine && buyer.userId ? { userId: buyer.userId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { market: { select: { locale: true, timeZone: true } }, invoice: { select: { number: true } } },
  });
}

export async function listOrders(db: Pick<PrismaClient, "order">, f: { status?: OrderStatus; q?: string } = {}) {
  const q = f.q?.trim();
  return db.order.findMany({
    where: { ...(f.status ? { status: f.status } : {}), ...(q ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { email: { contains: q.toLowerCase() } }, { name: { contains: q, mode: "insensitive" } }] } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { market: { select: { locale: true, name: true, timeZone: true } } },
  });
}

export async function getOrder(db: Pick<PrismaClient, "order">, id: string) {
  const o = await db.order.findUnique({ where: { id }, include: ORDER_INCLUDE });
  if (!o) throw new DomainError("not-found", "No such order.");
  return o;
}

export async function ordersWaiting(db: Pick<PrismaClient, "order">) {
  const [payment, toSend] = await Promise.all([db.order.count({ where: { status: "AWAITING_PAYMENT" } }), db.order.count({ where: { status: { in: TO_SEND } } })]);
  return { payment, toSend };
}

// ─── Staff actions ───────────────────────────────────────────────────

/** Gives special units back when an order is cancelled. */
async function releaseSpecials(tx: Prisma.TransactionClient, orderId: string) {
  const lines = await tx.orderLine.findMany({ where: { orderId, specialId: { not: null } }, select: { specialId: true, specialUnits: true } });
  const units = new Map<string, number>();
  for (const l of lines) units.set(l.specialId!, (units.get(l.specialId!) ?? 0) + l.specialUnits);
  for (const [id, n] of units) await tx.$executeRaw`UPDATE "Special" SET "quantityUsed" = GREATEST(0, "quantityUsed" - ${n}) WHERE "id" = ${id}`;
}

export interface PaymentInput {
  amount: string;
  reference: string;
  /** yyyy-mm-dd */
  receivedOn: string;
}

/** Records money received. Once payments cover the total, the order is paid and the customer told. */
export async function recordPayment(db: PrismaClient, actor: StaffActor, deps: OrderDeps, orderId: string, input: PaymentInput, ip?: string | null) {
  assertStaffCan(actor, "recordPayments");
  const now = deps.now ?? new Date();
  await db.$transaction(async (tx) => {
    const o = await tx.order.findUnique({ where: { id: orderId }, include: { payments: true, market: true, creditNotes: { select: { totalMinor: true } }, refunds: { select: { amountMinor: true } } } });
    if (!o) throw new DomainError("not-found", "No such order.");
    if (o.status === "CANCELLED") throw new DomainError("conflict", "This order was cancelled. Contact the customer about a refund instead.");
    let amount: bigint;
    try {
      amount = parseMoney(input.amount, o.currency);
      if (amount <= 0n) throw new Error();
    } catch {
      throw new DomainError("invalid", `Enter the amount received in ${o.currency}.`, "amount");
    }
    const reference = input.reference.trim().slice(0, 120);
    const receivedOn = /^\d{4}-\d{2}-\d{2}$/.test(input.receivedOn) ? new Date(`${input.receivedOn}T12:00:00Z`) : null;
    if (!receivedOn || Number.isNaN(receivedOn.getTime()) || receivedOn.getTime() > now.getTime() + 86_400_000) throw new DomainError("invalid", "Enter the date it arrived.", "receivedOn");
    await tx.orderPayment.create({ data: { orderId, method: o.paymentMethod, amountMinor: amount, reference, receivedOn, recordedByLabel: actor.name } });
    const m = orderMoney(o.totalMinor, [...o.payments, { amountMinor: amount }], o.creditNotes, o.refunds);
    const money = (n: bigint) => formatMoney({ amountMinor: n, currency: o.currency }, o.market.locale);
    // On account, the order goes ahead before payment; paying it only settles the balance.
    const nowPaid = o.paidAt === null && m.outstanding === 0n;
    if (nowPaid) {
      await tx.order.update({ where: { id: orderId }, data: { paidAt: now, ...(o.status === "AWAITING_PAYMENT" ? { status: "PAID" } : {}) } });
      await queueEmail(tx, deps.key, { to: o.email, kind: o.paymentMethod === "ACCOUNT" ? "order.settled" : "order.paid", payload: orderEmailPayload(o, o.market) });
    }
    await audit(tx, staffAudit(actor, { action: "order.payment", summary: `Recorded ${money(amount)} for order ${o.number}${reference ? ` (${reference})` : ""}${nowPaid ? ", now paid" : m.outstanding ? `, ${money(m.outstanding)} still to pay` : ""}`, organisationId: o.organisationId, subjectUserId: o.userId, targetType: "Order", targetId: orderId, ipAddress: ip }));
  });
}

/** Sent, or ready to collect. Only a paid order. */
export async function fulfilOrder(db: PrismaClient, actor: StaffActor, deps: OrderDeps, orderId: string, note: string, ip?: string | null) {
  assertStaffCan(actor, "fulfilOrders");
  const now = deps.now ?? new Date();
  await db.$transaction(async (tx) => {
    const o = await tx.order.findUnique({ where: { id: orderId }, include: { market: true } });
    if (!o) throw new DomainError("not-found", "No such order.");
    if (!TO_SEND.includes(o.status)) throw new DomainError("conflict", o.status === "AWAITING_PAYMENT" ? "This order isn't paid yet." : "This order has already been dealt with.");
    const text = note.trim().slice(0, 300);
    await tx.order.update({ where: { id: orderId }, data: { status: "FULFILLED", fulfilledAt: now } });
    // Whatever is still kept in stock for it leaves with it.
    const lines = await tx.orderLine.findMany({ where: { orderId }, select: { id: true, quantity: true } });
    await issueForDelivery(tx, lines.map((l) => ({ orderLineId: l.id, quantity: l.quantity, remaining: l.quantity })), actor.name);
    if (o.fulfilment === "DELIVERY") await advanceLines(tx, lines.map((l) => l.id), "OUT_FOR_DELIVERY", actor.name, text, now);
    await issueInvoice(tx, deps.key, orderId, now);
    await syncUnits(tx, orderId);
    await queueEmail(tx, deps.key, { to: o.email, kind: o.fulfilment === "COLLECTION" ? "order.ready" : "order.sent", payload: { ...orderEmailPayload(o, o.market), note: text } });
    await audit(tx, staffAudit(actor, { action: "order.fulfilled", summary: `Marked order ${o.number} as ${o.fulfilment === "COLLECTION" ? "ready to collect" : "sent"}${text ? `: ${text}` : ""}`, organisationId: o.organisationId, subjectUserId: o.userId, targetType: "Order", targetId: orderId, ipAddress: ip }));
  });
}

export async function cancelOrder(db: PrismaClient, actor: StaffActor | null, deps: OrderDeps, orderId: string, reason: string, ip?: string | null) {
  if (actor) assertStaffCan(actor, "cancelOrders");
  const now = deps.now ?? new Date();
  const why = reason.trim().slice(0, 300);
  if (actor && why.length < 3) throw new DomainError("invalid", "Say why, for the customer.", "reason");
  await db.$transaction(async (tx) => {
    const o = await tx.order.findUnique({ where: { id: orderId }, include: { market: true, payments: true } });
    if (!o) throw new DomainError("not-found", "No such order.");
    if (o.status === "CANCELLED" || o.status === "FULFILLED") throw new DomainError("conflict", "This order can't be cancelled now.");
    await tx.order.update({ where: { id: orderId }, data: { status: "CANCELLED", cancelledAt: now, cancelReason: why } });
    await releaseSpecials(tx, orderId);
    await releaseForOrder(tx, orderId, actor?.name ?? "System");
    const withSuppliers = await cancelUnsentFor(tx, orderId, now);
    const refund = o.payments.length > 0;
    await queueEmail(tx, deps.key, { to: o.email, kind: "order.cancelled", payload: { ...orderEmailPayload(o, o.market), reason: why, refund: refund ? "yes" : "" } });
    const summary = `Cancelled order ${o.number}: ${why}${refund ? ". Payments were received, so a refund is due" : ""}${withSuppliers ? `. ${withSuppliers} purchase ${withSuppliers === 1 ? "order is" : "orders are"} already with suppliers: cancel ${withSuppliers === 1 ? "it" : "them"} with the supplier` : ""}`;
    await audit(tx, actor ? staffAudit(actor, { action: "order.cancelled", summary, organisationId: o.organisationId, subjectUserId: o.userId, targetType: "Order", targetId: orderId, ipAddress: ip }) : { ...SYSTEM_ACTOR, action: "order.cancelled", summary, organisationId: o.organisationId, subjectUserId: o.userId, targetType: "Order", targetId: orderId, visibleToCustomer: Boolean(o.userId || o.organisationId) });
  });
}

/** The job: cancels bank transfer orders not paid by their date, so their special units go back. */
export async function cancelUnpaid(db: PrismaClient, deps: OrderDeps) {
  const now = deps.now ?? new Date();
  const due = await db.order.findMany({ where: { status: "AWAITING_PAYMENT", payBy: { lt: now }, payments: { none: {} } }, select: { id: true } });
  for (const o of due) {
    try {
      await cancelOrder(db, null, deps, o.id, "We didn't receive payment in time");
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
    }
  }
  return due.length;
}

