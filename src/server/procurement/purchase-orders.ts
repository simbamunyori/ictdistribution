import type { Prisma, PrismaClient, PurchaseOrderStatus, Supplier } from "@prisma/client";
import { company } from "@/config/app";
import { formatMoney, parseMoney, toPlainAmount } from "@/lib/money";
import { toBase } from "@/lib/pricing";
import { poReviewReasons } from "@/lib/procurement";
import { audit, staffAudit, SYSTEM_ACTOR } from "@/server/audit";
import { open, seal } from "@/server/auth/secret-box";
import { hashToken, newToken } from "@/server/auth/tokens";
import { queueEmail } from "@/server/email/outbox";
import { DomainError } from "@/server/errors";
import { asRate, currentRates, pricingSettings } from "@/server/pricing/rates";
import { assertStaffCan, type StaffActor } from "@/server/staff/access";
import { productSourcing } from "@/server/suppliers/sourcing";
import { procurementAddresses, procurementSettings, WITH_SUPPLIER } from "./common";

/**
 * Purchase orders: once an order is paid or put on account, what it needs
 * is grouped by supplier into one purchase order each. A purchase order
 * goes to its supplier by itself when the Admin's rules allow, and
 * otherwise waits for staff to approve it. Suppliers see our order and
 * what we pay them, never the customer or our price.
 */

export interface PoDeps {
  key: string;
  now?: Date;
  /** Where supplier replies go, such as the quotes mailbox. */
  replyTo?: string;
}

interface PlannedLine {
  orderLineId: string;
  description: string;
  mpn: string;
  quantity: number;
  unitCostMinor: bigint;
}

type OrderForPlan = Prisma.OrderGetPayload<{ include: { lines: true } }>;

/**
 * Who supplies each line and at what price: the supplier agreed when
 * quoting, else the one the sourcing rule picks now. A bundle is bought
 * as its products. Lines nobody supplies are left for staff.
 */
async function plan(db: PrismaClient, order: OrderForPlan) {
  const groups = new Map<string, { supplierId: string; currency: string; lines: PlannedLine[] }>();
  const unassigned: string[] = [];
  const add = (supplierId: string, currency: string, line: PlannedLine) => {
    const key = `${supplierId}:${currency}`;
    const g = groups.get(key) ?? { supplierId, currency, lines: [] };
    g.lines.push(line);
    groups.set(key, g);
  };
  const sourced = async (productId: string) => {
    try {
      return (await productSourcing(db, productId)).chosen?.offer ?? null;
    } catch (e) {
      if (e instanceof DomainError) return null;
      throw e;
    }
  };
  for (const l of order.lines) {
    if (l.supplierId && l.supplierCostMinor !== null && l.supplierCurrency) {
      add(l.supplierId, l.supplierCurrency, { orderLineId: l.id, description: l.description, mpn: l.mpn, quantity: l.quantity, unitCostMinor: l.supplierCostMinor });
    } else if (l.productId) {
      const offer = await sourced(l.productId);
      if (offer) add(offer.supplier.id, offer.currency, { orderLineId: l.id, description: l.description, mpn: l.mpn, quantity: l.quantity, unitCostMinor: offer.costMinor });
      else unassigned.push(l.description);
    } else if (l.bundleId) {
      const items = await db.specialItem.findMany({ where: { specialId: l.bundleId }, include: { product: { select: { id: true, name: true, mpn: true, brand: { select: { name: true } } } } } });
      for (const item of items) {
        const offer = await sourced(item.productId);
        const description = `${item.product.brand.name} ${item.product.name}`;
        if (offer) add(offer.supplier.id, offer.currency, { orderLineId: l.id, description, mpn: item.product.mpn, quantity: l.quantity * item.quantity, unitCostMinor: offer.costMinor });
        else unassigned.push(description);
      }
      if (!items.length) unassigned.push(l.description);
    } else unassigned.push(l.description);
  }
  return { groups: [...groups.values()], unassigned };
}

const PO_EMAIL_INCLUDE = { supplier: true, lines: { orderBy: { position: "asc" } } } satisfies Prisma.PurchaseOrderInclude;
type PoForEmail = Prisma.PurchaseOrderGetPayload<{ include: typeof PO_EMAIL_INCLUDE }>;

/** Sends it by email, or readies it for staff to send on WhatsApp. */
async function dispatch(tx: Prisma.TransactionClient, deps: PoDeps, po: PoForEmail, now: Date, approvedBy: string | null) {
  const settings = await procurementSettings(tx);
  const token = open(po.tokenSealed, deps.key);
  const byEmail = po.channel === "EMAIL" && Boolean(po.supplier.email);
  const status: PurchaseOrderStatus = byEmail ? "SENT" : "TO_SEND_BY_HAND";
  await tx.purchaseOrder.update({ where: { id: po.id }, data: { status, sentAt: byEmail ? now : null, approvedByLabel: approvedBy, reviewReasons: approvedBy ? po.reviewReasons : null } });
  if (byEmail) {
    const money = (n: bigint) => formatMoney({ amountMinor: n, currency: po.currency }, company.staffLocale);
    await queueEmail(tx, deps.key, {
      to: po.supplier.email!,
      kind: "supplier.po",
      payload: { number: po.number, supplier: po.supplier.name, total: money(po.totalMinor), lines: po.lines.map((l) => `${l.quantity} x ${l.description}${l.mpn ? ` (${l.mpn})` : ""} at ${money(l.unitCostMinor)}`).join("\n"), deliverTo: settings.deliverTo, paymentTerms: settings.paymentTerms, replyTo: deps.replyTo ?? "" },
      secret: { token },
    });
  }
  return status;
}

/**
 * Makes the purchase orders for a paid or on-account order, once. Each
 * goes out by itself when inside the rules; the rest wait for approval,
 * and procurement staff are told what needs them.
 */
export async function startProcurement(db: PrismaClient, deps: PoDeps, orderId: string) {
  const now = deps.now ?? new Date();
  const order = await db.order.findUnique({ where: { id: orderId }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
  if (!order || order.procuredAt || !["PAID", "ON_ACCOUNT", "FULFILLED"].includes(order.status)) return [];
  const { groups, unassigned } = await plan(db, order);
  const [settings, pricing] = await Promise.all([procurementSettings(db), pricingSettings(db)]);
  const rates = await currentRates(db, pricing.baseCurrency);
  const suppliers = new Map((await db.supplier.findMany({ where: { id: { in: groups.map((g) => g.supplierId) } } })).map((s) => [s.id, s]));
  const maxValueText = formatMoney({ amountMinor: settings.maxAutoValueMinor, currency: pricing.baseCurrency }, company.staffLocale);

  return db.$transaction(async (tx) => {
    // Claimed in the same transaction, so two runs never make them twice.
    const claimed = await tx.order.updateMany({ where: { id: orderId, procuredAt: null }, data: { procuredAt: now } });
    if (!claimed.count) return [];
    const made: { number: string; status: PurchaseOrderStatus }[] = [];
    for (const g of groups) {
      const supplier = suppliers.get(g.supplierId)!;
      const total = g.lines.reduce((s, l) => s + l.unitCostMinor * BigInt(l.quantity), 0n);
      const rate = g.currency === pricing.baseCurrency ? null : asRate(rates.get(g.currency));
      const totalBase = g.currency === pricing.baseCurrency || rate ? toBase({ amountMinor: total, currency: g.currency }, pricing.baseCurrency, rate).amountMinor : null;
      const reasons = poReviewReasons(settings, { supplier, currency: g.currency, totalBase, maxValueText });
      const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('po_number_seq') AS n`;
      const token = newToken();
      const po = await tx.purchaseOrder.create({
        data: {
          number: `${settings.poPrefix}-${n}`,
          orderId,
          supplierId: supplier.id,
          status: "AWAITING_APPROVAL",
          channel: supplier.email ? "EMAIL" : "WHATSAPP",
          currency: g.currency,
          totalMinor: total,
          totalBaseMinor: totalBase,
          reviewReasons: reasons.length ? reasons.join("\n") : null,
          tokenHash: hashToken(token),
          tokenSealed: seal(token, deps.key),
          lines: { create: g.lines.map((l, i) => ({ ...l, position: i + 1, lineTotalMinor: l.unitCostMinor * BigInt(l.quantity) })) },
        },
        include: PO_EMAIL_INCLUDE,
      });
      const status = reasons.length ? "AWAITING_APPROVAL" : await dispatch(tx, deps, po, now, null);
      made.push({ number: po.number, status });
      await audit(tx, { ...SYSTEM_ACTOR, action: "po.created", summary: `Made purchase order ${po.number} to ${supplier.name} for ${formatMoney({ amountMinor: total, currency: g.currency }, company.staffLocale)}, for order ${order.number}${status === "SENT" ? ", sent by itself" : status === "TO_SEND_BY_HAND" ? ", to send on WhatsApp" : ", waiting for approval"}`, targetType: "PurchaseOrder", targetId: po.id });
    }
    const waiting = made.filter((m) => m.status !== "SENT");
    if (waiting.length || unassigned.length) {
      for (const to of await procurementAddresses(tx)) await queueEmail(tx, deps.key, { to, kind: "po.to-approve", payload: { order: order.number, orderId, waiting: waiting.map((m) => m.number).join(", "), unassigned: unassigned.join("\n") } });
    }
    return made;
  });
}

/** The job: orders paid or put on account whose purchase orders weren't made yet, such as when staff record a payment. */
export async function procureWaiting(db: PrismaClient, deps: PoDeps) {
  const due = await db.order.findMany({ where: { procuredAt: null, status: { in: ["PAID", "ON_ACCOUNT"] } }, select: { id: true }, orderBy: { createdAt: "asc" }, take: 50 });
  let made = 0;
  for (const o of due) made += (await startProcurement(db, deps, o.id)).length;
  return made;
}

// ─── Staff ───────────────────────────────────────────────────────────

async function locked(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE id = ${id} FOR UPDATE`;
  const po = await tx.purchaseOrder.findUnique({ where: { id }, include: PO_EMAIL_INCLUDE });
  if (!po) throw new DomainError("not-found", "No such purchase order.");
  return po;
}

/** Staff approve a purchase order: it goes to the supplier by email, or is readied for WhatsApp. */
export async function approvePurchaseOrder(db: PrismaClient, actor: StaffActor, deps: PoDeps, id: string, ip?: string | null) {
  assertStaffCan(actor, "managePurchaseOrders");
  const now = deps.now ?? new Date();
  return db.$transaction(async (tx) => {
    const po = await locked(tx, id);
    if (po.status !== "AWAITING_APPROVAL") throw new DomainError("conflict", "This purchase order has already been dealt with.");
    if (!po.supplier.active) throw new DomainError("conflict", `${po.supplier.name} is switched off. Switch them on, or cancel this purchase order.`);
    const status = await dispatch(tx, deps, po, now, actor.name);
    await audit(tx, staffAudit(actor, { action: "po.approved", summary: `Approved purchase order ${po.number} to ${po.supplier.name}${status === "SENT" ? " and sent it by email" : ", to send on WhatsApp"}`, targetType: "PurchaseOrder", targetId: id, ipAddress: ip }));
    return status;
  });
}

export async function markPoSentByHand(db: PrismaClient, actor: StaffActor, deps: PoDeps, id: string, ip?: string | null) {
  assertStaffCan(actor, "managePurchaseOrders");
  const now = deps.now ?? new Date();
  await db.$transaction(async (tx) => {
    const po = await locked(tx, id);
    if (po.status !== "TO_SEND_BY_HAND") throw new DomainError("conflict", "This purchase order has already been sent.");
    await tx.purchaseOrder.update({ where: { id }, data: { status: "SENT", sentAt: now } });
    await audit(tx, staffAudit(actor, { action: "po.sent-by-hand", summary: `Sent purchase order ${po.number} to ${po.supplier.name} on WhatsApp`, targetType: "PurchaseOrder", targetId: id, ipAddress: ip }));
  });
}

/** Staff cancel it. A supplier who already has it is told by email. */
export async function cancelPurchaseOrder(db: PrismaClient, actor: StaffActor, deps: PoDeps, id: string, reasonInput: string, ip?: string | null) {
  assertStaffCan(actor, "managePurchaseOrders");
  const reason = reasonInput.trim().slice(0, 300);
  if (reason.length < 3) throw new DomainError("invalid", "Say why, for the supplier.", "reason");
  const now = deps.now ?? new Date();
  await db.$transaction(async (tx) => {
    const po = await locked(tx, id);
    if (po.status === "SHIPPED" || po.status === "RECEIVED" || po.status === "CANCELLED") throw new DomainError("conflict", "This purchase order can't be cancelled now.");
    await tx.purchaseOrder.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: now, cancelReason: reason } });
    if ((po.status === "SENT" || po.status === "CONFIRMED") && po.supplier.email) await queueEmail(tx, deps.key, { to: po.supplier.email, kind: "supplier.po-cancelled", payload: { number: po.number, supplier: po.supplier.name, reason, replyTo: deps.replyTo ?? "" } });
    await audit(tx, staffAudit(actor, { action: "po.cancelled", summary: `Cancelled purchase order ${po.number} to ${po.supplier.name}: ${reason}`, targetType: "PurchaseOrder", targetId: id, ipAddress: ip }));
  });
}

/** The goods are in our hands. */
export async function markPoReceived(db: PrismaClient, actor: StaffActor, deps: PoDeps, id: string, ip?: string | null) {
  assertStaffCan(actor, "managePurchaseOrders");
  const now = deps.now ?? new Date();
  await db.$transaction(async (tx) => {
    const po = await locked(tx, id);
    if (!WITH_SUPPLIER.includes(po.status)) throw new DomainError("conflict", "Only a purchase order with the supplier can be received.");
    await tx.purchaseOrder.update({ where: { id }, data: { status: "RECEIVED", receivedAt: now } });
    await audit(tx, staffAudit(actor, { action: "po.received", summary: `Received the goods for purchase order ${po.number} from ${po.supplier.name}`, targetType: "PurchaseOrder", targetId: id, ipAddress: ip }));
  });
}

/** When the order is cancelled, purchase orders not yet with a supplier are cancelled too; the rest are for staff to settle with the supplier. */
export async function cancelUnsentFor(tx: Prisma.TransactionClient, orderId: string, now: Date) {
  await tx.purchaseOrder.updateMany({ where: { orderId, status: { in: ["AWAITING_APPROVAL", "TO_SEND_BY_HAND"] } }, data: { status: "CANCELLED", cancelledAt: now, cancelReason: "The customer's order was cancelled." } });
  return tx.purchaseOrder.count({ where: { orderId, status: { in: WITH_SUPPLIER } } });
}

// ─── Reading ─────────────────────────────────────────────────────────

export async function listPurchaseOrders(db: Pick<PrismaClient, "purchaseOrder">, f: { status?: PurchaseOrderStatus; q?: string } = {}) {
  const q = f.q?.trim();
  return db.purchaseOrder.findMany({
    where: { ...(f.status ? { status: f.status } : {}), ...(q ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { supplier: { name: { contains: q, mode: "insensitive" } } }, { order: { number: { contains: q, mode: "insensitive" } } }, { supplierReference: { contains: q, mode: "insensitive" } }] } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { supplier: { select: { name: true } }, order: { select: { id: true, number: true } }, _count: { select: { lines: true, documents: true } } },
  });
}

/** Counts for the admin menu: to approve, and to send on WhatsApp. */
export async function purchaseOrdersWaiting(db: Pick<PrismaClient, "purchaseOrder">) {
  const [approve, byHand] = await Promise.all([db.purchaseOrder.count({ where: { status: "AWAITING_APPROVAL" } }), db.purchaseOrder.count({ where: { status: "TO_SEND_BY_HAND" } })]);
  return { approve, byHand };
}

export const STAFF_PO_INCLUDE = {
  supplier: true,
  order: { select: { id: true, number: true, status: true, market: { select: { name: true } } } },
  lines: { orderBy: { position: "asc" } },
  documents: { orderBy: { createdAt: "asc" }, omit: { bytes: true } },
} satisfies Prisma.PurchaseOrderInclude;

export async function getPurchaseOrder(db: Pick<PrismaClient, "purchaseOrder">, id: string) {
  const po = await db.purchaseOrder.findUnique({ where: { id }, include: STAFF_PO_INCLUDE });
  if (!po) throw new DomainError("not-found", "No such purchase order.");
  return po;
}

/** The supplier's page link, opened from its sealed copy, for staff to send by hand. */
export function poLink(po: { tokenSealed: string }, key: string, appUrl: string) {
  return `${appUrl}/supplier/po/${open(po.tokenSealed, key)}`;
}

/** A WhatsApp message with the purchase order and its link, ready to send. */
export function poWhatsappLink(po: { tokenSealed: string; number: string; currency: string; totalMinor: bigint }, supplier: Pick<Supplier, "whatsapp" | "name">, lines: { quantity: number; description: string }[], key: string, appUrl: string) {
  if (!supplier.whatsapp) return null;
  const total = formatMoney({ amountMinor: po.totalMinor, currency: po.currency }, company.staffLocale);
  const text = [`Hello ${supplier.name}, this is ${company.name}. Please supply purchase order ${po.number} for ${total}:`, ...lines.map((l) => `${l.quantity} x ${l.description}`), `Confirm it and add ship dates, your invoice and serial numbers here: ${poLink(po, key, appUrl)}`].join("\n");
  return `https://wa.me/${supplier.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}

// ─── Rules ───────────────────────────────────────────────────────────

export interface ProcurementRulesInput {
  autoSend: boolean;
  maxAutoValue: string;
  onlyPreferred: boolean;
  deliverTo: string;
  paymentTerms: string;
}

export async function procurementRulesForm(db: PrismaClient) {
  const [s, base] = await Promise.all([procurementSettings(db), pricingSettings(db).then((p) => p.baseCurrency)]);
  return { base, values: { autoSend: s.autoSend, maxAutoValue: toPlainAmount({ amountMinor: s.maxAutoValueMinor, currency: base }), onlyPreferred: s.onlyPreferred, deliverTo: s.deliverTo, paymentTerms: s.paymentTerms } };
}

export async function updateProcurementRules(db: PrismaClient, actor: StaffActor, input: ProcurementRulesInput, ip?: string | null) {
  assertStaffCan(actor, "manageProcurementRules");
  const base = (await pricingSettings(db)).baseCurrency;
  const fieldErrors: Record<string, string> = {};
  let maxAutoValueMinor = 0n;
  try {
    maxAutoValueMinor = parseMoney(input.maxAutoValue, base);
    if (maxAutoValueMinor < 0n) throw new Error();
  } catch {
    fieldErrors.maxAutoValue = `Enter an amount in ${base}.`;
  }
  const deliverTo = input.deliverTo.trim();
  const paymentTerms = input.paymentTerms.trim();
  if (deliverTo.length > 500) fieldErrors.deliverTo = "Keep it under 500 characters.";
  if (paymentTerms.length > 300) fieldErrors.paymentTerms = "Keep it under 300 characters.";
  if (Object.keys(fieldErrors).length) throw new DomainError("invalid", "Check the highlighted fields.", undefined, fieldErrors);
  await db.$transaction(async (tx) => {
    await procurementSettings(tx);
    await tx.procurementSettings.update({ where: { id: "global" }, data: { autoSend: input.autoSend, maxAutoValueMinor, onlyPreferred: input.onlyPreferred, deliverTo, paymentTerms } });
    await audit(tx, staffAudit(actor, { action: "procurement.rules", summary: `Changed the purchase order rules: ${input.autoSend ? `send by itself up to ${formatMoney({ amountMinor: maxAutoValueMinor, currency: base }, company.staffLocale)}${input.onlyPreferred ? " to preferred suppliers" : ""}` : "always approve first"}`, targetType: "ProcurementSettings", targetId: "global", ipAddress: ip }));
  });
}
