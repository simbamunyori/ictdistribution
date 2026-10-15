import type { Prisma, PrismaClient, ReturnReason, ReturnStatus } from "@prisma/client";
import { audit, staffAudit } from "@/server/audit";
import { queueEmail } from "@/server/email/outbox";
import { DomainError } from "@/server/errors";
import { assertStaffCan, type StaffActor } from "@/server/staff/access";
import { assertPortalCan, inScope, scopeWhere, type PortalViewer } from "./scope";

/**
 * Returns. A customer asks to send back items that have reached them,
 * saying why; staff approve (with how to send them) or decline (with
 * why), mark the items received and settle it with a note: refunded,
 * replaced or repaired. A change of mind must be asked for within the
 * return window in the shop settings; a fault at any time.
 */

export const RETURN_REASON_LABEL: Record<ReturnReason, string> = {
  FAULTY: "It is faulty",
  DAMAGED: "It arrived damaged",
  WRONG_ITEM: "We sent the wrong item",
  NOT_NEEDED: "I no longer need it",
  OTHER: "Something else",
};

export const RETURN_REASONS = Object.keys(RETURN_REASON_LABEL) as ReturnReason[];

export const RETURN_STATUS_LABEL: Record<ReturnStatus, string> = {
  REQUESTED: "Waiting for us",
  APPROVED: "Approved: send it back",
  DECLINED: "Declined",
  RECEIVED: "Back with us",
  CLOSED: "Settled",
  CANCELLED: "Withdrawn",
};

export const RETURN_STAFF_LABEL: Record<ReturnStatus, string> = {
  REQUESTED: "To answer",
  APPROVED: "Approved, coming back",
  DECLINED: "Declined",
  RECEIVED: "Received, to settle",
  CLOSED: "Settled",
  CANCELLED: "Withdrawn",
};

export const RETURN_STATUS_TONE = { REQUESTED: "warning", APPROVED: "neutral", DECLINED: "negative", RECEIVED: "neutral", CLOSED: "positive", CANCELLED: "neutral" } as const;

/** Returns that still hold their items: anything not declined or withdrawn. */
const HOLDING: ReturnStatus[] = ["REQUESTED", "APPROVED", "RECEIVED", "CLOSED"];

export interface ReturnDeps {
  key: string;
  now?: Date;
}

type Db = Pick<PrismaClient, "order" | "shopSettings">;

/**
 * What can be sent back from an order: per line, what has left us less
 * what is already in a return, and when the return window closes.
 */
export async function returnableLines(db: Db | Prisma.TransactionClient, orderId: string, now = new Date()) {
  const [o, settings] = await Promise.all([
    db.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        lines: { orderBy: { sortOrder: "asc" }, include: { deliveryLines: { where: { delivery: { status: { not: "PREPARED" } } }, select: { quantity: true } }, returnLines: { where: { request: { status: { in: HOLDING } } }, select: { quantity: true } } } },
        deliveries: { where: { status: { not: "PREPARED" } }, select: { dispatchedAt: true }, orderBy: { dispatchedAt: "asc" }, take: 1 },
      },
    }),
    db.shopSettings.findUnique({ where: { id: "global" } }),
  ]);
  const sentAt = o.fulfilledAt ?? o.deliveries[0]?.dispatchedAt ?? null;
  const returnDays = settings?.returnDays ?? 14;
  const closes = sentAt ? new Date(sentAt.getTime() + returnDays * 86_400_000) : null;
  const lines = o.lines.map((l) => {
    const sent = o.status === "FULFILLED" ? l.quantity : Math.min(l.quantity, l.deliveryLines.reduce((s, d) => s + d.quantity, 0));
    const returned = l.returnLines.reduce((s, r) => s + r.quantity, 0);
    return { id: l.id, description: l.description, mpn: l.mpn, quantity: l.quantity, sent, returned, available: Math.max(0, sent - returned) };
  });
  return { order: o, lines, sentAt, closes, returnDays, open: o.status !== "CANCELLED" && lines.some((l) => l.available > 0), changeOfMindOpen: closes !== null && now.getTime() <= closes.getTime() };
}

export interface ReturnInput {
  reason: string;
  details: string;
  /** Quantity to return, by order line id. */
  quantities: Record<string, string>;
}

/** The customer asks to return items from one of their orders. */
export async function requestReturn(db: PrismaClient, deps: ReturnDeps, v: PortalViewer, orderNumber: string, input: ReturnInput, ip?: string | null) {
  assertPortalCan(v, "buy");
  const now = deps.now ?? new Date();
  return db.$transaction(async (tx) => {
    const found = await tx.order.findUnique({ where: { number: orderNumber }, select: { id: true } });
    if (!found) throw new DomainError("not-found", "No such order.");
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${found.id} FOR UPDATE`;
    const r = await returnableLines(tx, found.id, now);
    const o = r.order;
    if (!inScope(v, o)) throw new DomainError("not-found", "No such order.");
    const fieldErrors: Record<string, string> = {};
    const reason = input.reason as ReturnReason;
    if (!RETURN_REASONS.includes(reason)) fieldErrors.reason = "Choose why.";
    const details = input.details.trim();
    if (details.length < 5 || details.length > 1000) fieldErrors.details = "Tell us what is wrong, in a few words.";
    const chosen: { orderLineId: string; quantity: number; description: string }[] = [];
    for (const l of r.lines) {
      const t = (input.quantities[l.id] ?? "").trim();
      if (!t || t === "0") continue;
      const n = /^\d{1,6}$/.test(t) ? Number(t) : NaN;
      if (!Number.isInteger(n) || n > l.available) fieldErrors[`qty-${l.id}`] = l.available ? `Enter up to ${l.available}.` : "Nothing of this line can be returned.";
      else chosen.push({ orderLineId: l.id, quantity: n, description: l.description });
    }
    if (Object.keys(fieldErrors).length) throw new DomainError("invalid", "Check the highlighted fields.", undefined, fieldErrors);
    if (!chosen.length) throw new DomainError("invalid", "Enter how many of each item you want to return.");
    if (reason !== "FAULTY" && !r.changeOfMindOpen) throw new DomainError("invalid", `Returns for this reason are accepted within ${r.returnDays} days of the order leaving us. If it is faulty, choose that reason.`, undefined, { reason: "Outside the return window." });
    const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('return_number_seq') AS n`;
    const created = await tx.returnRequest.create({
      data: { number: `RMA-${n}`, orderId: o.id, userId: v.userId, organisationId: o.organisationId, reason, details, requestedByLabel: v.name, lines: { create: chosen.map((c) => ({ orderLineId: c.orderLineId, quantity: c.quantity })) } },
    });
    await queueEmail(tx, deps.key, { to: v.email, kind: "return.requested", payload: { number: created.number, order: o.number, lines: chosen.map((c) => `${c.quantity} x ${c.description}`).join("\n") } });
    await audit(tx, { actorKind: "CUSTOMER", actorUserId: v.userId, actorLabel: v.name, action: "return.requested", summary: `Asked to return ${chosen.reduce((s, c) => s + c.quantity, 0)} ${chosen.length === 1 && chosen[0].quantity === 1 ? "item" : "items"} from order ${o.number} as ${created.number}: ${RETURN_REASON_LABEL[reason].toLowerCase()}`, organisationId: o.organisationId, subjectUserId: v.userId, targetType: "ReturnRequest", targetId: created.id, visibleToCustomer: true, ipAddress: ip });
    return created;
  });
}

/** The customer withdraws a request we haven't answered yet. */
export async function withdrawReturn(db: PrismaClient, v: PortalViewer, number: string, ip?: string | null) {
  assertPortalCan(v, "buy");
  await db.$transaction(async (tx) => {
    const r = await tx.returnRequest.findUnique({ where: { number } });
    if (!r || !inScope(v, r)) throw new DomainError("not-found", "No such return.");
    if (r.status !== "REQUESTED") throw new DomainError("conflict", "We have already answered this return. Contact us to change it.");
    await tx.returnRequest.update({ where: { id: r.id }, data: { status: "CANCELLED" } });
    await audit(tx, { actorKind: "CUSTOMER", actorUserId: v.userId, actorLabel: v.name, action: "return.withdrawn", summary: `Withdrew return ${r.number}`, organisationId: r.organisationId, subjectUserId: v.userId, targetType: "ReturnRequest", targetId: r.id, visibleToCustomer: true, ipAddress: ip });
  });
}

const RETURN_INCLUDE = {
  order: { select: { id: true, number: true, email: true, name: true, organisationId: true, userId: true, market: { select: { locale: true, timeZone: true } }, organisation: { select: { name: true } } } },
  lines: { include: { orderLine: { select: { description: true, mpn: true, quantity: true } } } },
} satisfies Prisma.ReturnRequestInclude;

export async function customerReturns(db: Pick<PrismaClient, "returnRequest">, v: Pick<PortalViewer, "userId" | "organisationId">) {
  return db.returnRequest.findMany({ where: scopeWhere(v), orderBy: { createdAt: "desc" }, take: 200, include: RETURN_INCLUDE });
}

export async function customerReturn(db: Pick<PrismaClient, "returnRequest">, v: Pick<PortalViewer, "userId" | "organisationId">, number: string) {
  const r = await db.returnRequest.findUnique({ where: { number }, include: RETURN_INCLUDE });
  return r && inScope(v, r) ? r : null;
}

// ─── Staff ───────────────────────────────────────────────────────────

export async function listReturns(db: Pick<PrismaClient, "returnRequest">, f: { status?: ReturnStatus } = {}) {
  return db.returnRequest.findMany({ where: f.status ? { status: f.status } : {}, orderBy: { createdAt: "desc" }, take: 200, include: RETURN_INCLUDE });
}

export async function getReturn(db: Pick<PrismaClient, "returnRequest">, id: string) {
  const r = await db.returnRequest.findUnique({ where: { id }, include: RETURN_INCLUDE });
  if (!r) throw new DomainError("not-found", "No such return.");
  return r;
}

export async function returnsWaiting(db: Pick<PrismaClient, "returnRequest">) {
  return db.returnRequest.count({ where: { status: { in: ["REQUESTED", "APPROVED", "RECEIVED"] } } });
}

export type ReturnStep = "approve" | "decline" | "receive" | "close";

const STEP: Record<ReturnStep, { from: ReturnStatus[]; to: ReturnStatus; email: string; noteNeeded: boolean; done: string }> = {
  approve: { from: ["REQUESTED"], to: "APPROVED", email: "return.approved", noteNeeded: false, done: "Approved" },
  decline: { from: ["REQUESTED", "APPROVED"], to: "DECLINED", email: "return.declined", noteNeeded: true, done: "Declined" },
  receive: { from: ["APPROVED"], to: "RECEIVED", email: "return.received", noteNeeded: false, done: "Received the items for" },
  close: { from: ["RECEIVED"], to: "CLOSED", email: "return.closed", noteNeeded: true, done: "Settled" },
};

/** Moves a return on, tells the customer, and records it in their history. */
export async function advanceReturn(db: PrismaClient, actor: StaffActor, deps: ReturnDeps, id: string, step: ReturnStep, noteInput: string, ip?: string | null) {
  assertStaffCan(actor, "manageReturns");
  const s = STEP[step];
  if (!s) throw new DomainError("invalid", "Choose what to do.");
  const now = deps.now ?? new Date();
  const note = noteInput.trim().slice(0, 1000);
  if (s.noteNeeded && note.length < 3) throw new DomainError("invalid", step === "decline" ? "Say why, for the customer." : "Say how it was settled, for the customer: refunded, replaced or repaired.", "note");
  await db.$transaction(async (tx) => {
    const r = await tx.returnRequest.findUnique({ where: { id }, include: { order: { select: { number: true, email: true } } } });
    if (!r) throw new DomainError("not-found", "No such return.");
    if (!s.from.includes(r.status)) throw new DomainError("conflict", `This return is ${RETURN_STATUS_LABEL[r.status].toLowerCase()}, so it can't be ${STEP[step].done.toLowerCase()} now.`);
    const n = await tx.returnRequest.updateMany({
      where: { id, status: r.status },
      data: { status: s.to, ...(note ? { note } : {}), ...(step === "approve" || step === "decline" ? { decidedAt: now, decidedByLabel: actor.name } : {}), ...(step === "receive" ? { receivedAt: now } : {}), ...(step === "close" ? { closedAt: now } : {}) },
    });
    if (n.count !== 1) throw new DomainError("conflict", "Someone else has just changed this return. Look again.");
    const user = r.userId ? await tx.user.findUnique({ where: { id: r.userId }, select: { email: true } }) : null;
    await queueEmail(tx, deps.key, { to: user?.email ?? r.order.email, kind: s.email, payload: { number: r.number, order: r.order.number, note } });
    await audit(tx, staffAudit(actor, { action: `return.${step}`, summary: `${s.done} return ${r.number} for order ${r.order.number}${note ? `: ${note}` : ""}`, organisationId: r.organisationId, subjectUserId: r.userId, targetType: "ReturnRequest", targetId: id, ipAddress: ip, visibleToCustomer: true }));
  });
}
