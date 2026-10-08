import type { Prisma, PrismaClient, ReturnOutcome, ReturnReason, ReturnStatus } from "@prisma/client";
import { serialKey, warrantyState } from "@/lib/warranty";
import { creditFor, issueCreditNote } from "@/server/aftersales/credit-notes";
import { audit, staffAudit } from "@/server/audit";
import { queueEmail } from "@/server/email/outbox";
import { DomainError } from "@/server/errors";
import { assertStaffCan, type StaffActor } from "@/server/staff/access";
import { assertPortalCan, inScope, scopeWhere, type PortalViewer } from "./scope";

/**
 * Returns and repairs. A customer asks to send back items that have
 * reached them, saying why, which serial numbers and what they would
 * like: a credit, a replacement or a repair. Staff approve (with how to
 * send them) or decline (with why); the customer can add their courier's
 * tracking number; staff mark the items received, and settle it: repair
 * and send back, replace with new serial numbers, or credit the invoice.
 * A change of mind must be asked for within the return window in the
 * shop settings; a fault at any time.
 */

export const RETURN_REASON_LABEL: Record<ReturnReason, string> = {
  FAULTY: "It is faulty",
  DAMAGED: "It arrived damaged",
  WRONG_ITEM: "We sent the wrong item",
  NOT_NEEDED: "I no longer need it",
  OTHER: "Something else",
};

export const RETURN_REASONS = Object.keys(RETURN_REASON_LABEL) as ReturnReason[];

/** What a customer may ask for. */
export const RETURN_WANTS_LABEL: Record<Exclude<ReturnOutcome, "OTHER">, string> = { REPAIR: "A repair", REPLACEMENT: "A replacement", CREDIT: "A credit or refund" };
export const RETURN_WANTS = Object.keys(RETURN_WANTS_LABEL) as Exclude<ReturnOutcome, "OTHER">[];

export const RETURN_OUTCOME_LABEL: Record<ReturnOutcome, string> = { REPAIR: "Repaired and sent back", REPLACEMENT: "Replaced", CREDIT: "Credited", OTHER: "Settled" };

export const RETURN_STATUS_LABEL: Record<ReturnStatus, string> = {
  REQUESTED: "Waiting for us",
  APPROVED: "Approved: send it back",
  DECLINED: "Declined",
  RECEIVED: "Back with us",
  IN_REPAIR: "Being repaired",
  CLOSED: "Settled",
  CANCELLED: "Withdrawn",
};

export const RETURN_STAFF_LABEL: Record<ReturnStatus, string> = {
  REQUESTED: "To answer",
  APPROVED: "Approved, coming back",
  DECLINED: "Declined",
  RECEIVED: "Received, to settle",
  IN_REPAIR: "In repair",
  CLOSED: "Settled",
  CANCELLED: "Withdrawn",
};

export const RETURN_STATUS_TONE = { REQUESTED: "warning", APPROVED: "neutral", DECLINED: "negative", RECEIVED: "neutral", IN_REPAIR: "warning", CLOSED: "positive", CANCELLED: "neutral" } as const;

/** Returns that still hold their items: anything not declined or withdrawn. */
const HOLDING: ReturnStatus[] = ["REQUESTED", "APPROVED", "RECEIVED", "IN_REPAIR", "CLOSED"];
/** Returns still open. */
const OPEN: ReturnStatus[] = ["REQUESTED", "APPROVED", "RECEIVED", "IN_REPAIR"];

export interface ReturnDeps {
  key: string;
  now?: Date;
}

type Db = Pick<PrismaClient, "order" | "shopSettings">;

/**
 * What can be sent back from an order: per line, what has left us less
 * what is already in a return, with the line's serial-numbered units
 * that are still with the customer and in no open return, and when the
 * return window closes.
 */
export async function returnableLines(db: Db | Prisma.TransactionClient, orderId: string, now = new Date()) {
  const [o, settings] = await Promise.all([
    db.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        lines: {
          orderBy: { sortOrder: "asc" },
          include: {
            deliveryLines: { where: { delivery: { status: { not: "PREPARED" } } }, select: { quantity: true } },
            returnLines: { where: { request: { status: { in: HOLDING } } }, select: { quantity: true } },
            units: { where: { status: "WITH_CUSTOMER", returnUnits: { none: { returnLine: { request: { status: { in: OPEN } } } } } }, orderBy: { serial: "asc" }, select: { id: true, serial: true, startsAt: true, endsAt: true, warrantyMonths: true } },
          },
        },
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
    const available = Math.max(0, sent - returned);
    // A unit repaired or replaced comes back to the customer and can be returned again, even when the line's count is used up.
    const units = l.units.filter((u) => u.startsAt).map((u) => ({ id: u.id, serial: u.serial, warranty: warrantyState(u, now), endsAt: u.endsAt }));
    return { id: l.id, description: l.description, mpn: l.mpn, quantity: l.quantity, sent, returned, available: Math.max(available, units.length), units };
  });
  return { order: o, lines, sentAt, closes, returnDays, open: o.status !== "CANCELLED" && lines.some((l) => l.available > 0), changeOfMindOpen: closes !== null && now.getTime() <= closes.getTime() };
}

export interface ReturnInput {
  reason: string;
  details: string;
  /** What the customer would like: REPAIR, REPLACEMENT or CREDIT. */
  wants: string;
  /** Quantity to return, by order line id. */
  quantities: Record<string, string>;
  /** Serial-numbered units chosen, by id. */
  units: string[];
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
    const wants = input.wants as Exclude<ReturnOutcome, "OTHER">;
    if (!RETURN_WANTS.includes(wants)) fieldErrors.wants = "Choose what you would like us to do.";
    const details = input.details.trim();
    if (details.length < 5 || details.length > 1000) fieldErrors.details = "Tell us what is wrong, in a few words.";
    const picked = new Set(input.units);
    const chosen: { orderLineId: string; quantity: number; description: string; unitIds: string[]; serials: string[] }[] = [];
    for (const l of r.lines) {
      const units = l.units.filter((u) => picked.has(u.id));
      const t = (input.quantities[l.id] ?? "").trim();
      if ((!t || t === "0") && !units.length) continue;
      const n = !t ? units.length : /^\d{1,6}$/.test(t) ? Number(t) : NaN;
      if (!Number.isInteger(n) || n > l.available) fieldErrors[`qty-${l.id}`] = l.available ? `Enter up to ${l.available}.` : "Nothing of this line can be returned.";
      else if (n < units.length) fieldErrors[`qty-${l.id}`] = `You chose ${units.length} serial numbers. Enter at least ${units.length}.`;
      else if (n > 0) chosen.push({ orderLineId: l.id, quantity: n, description: l.description, unitIds: units.map((u) => u.id), serials: units.map((u) => u.serial) });
    }
    if (Object.keys(fieldErrors).length) throw new DomainError("invalid", "Check the highlighted fields.", undefined, fieldErrors);
    if (!chosen.length) throw new DomainError("invalid", "Enter how many of each item you want to return.");
    if (reason !== "FAULTY" && !r.changeOfMindOpen) throw new DomainError("invalid", `Returns for this reason are accepted within ${r.returnDays} days of the order leaving us. If it is faulty, choose that reason.`, undefined, { reason: "Outside the return window." });
    const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('return_number_seq') AS n`;
    const created = await tx.returnRequest.create({
      data: {
        number: `RMA-${n}`,
        orderId: o.id,
        userId: v.userId,
        organisationId: o.organisationId,
        reason,
        wants,
        details,
        requestedByLabel: v.name,
        lines: { create: chosen.map((c) => ({ orderLineId: c.orderLineId, quantity: c.quantity, units: { create: c.unitIds.map((unitId) => ({ unitId })) } })) },
      },
    });
    const list = chosen.map((c) => `${c.quantity} x ${c.description}${c.serials.length ? `, serial ${c.serials.join(", ")}` : ""}`);
    await queueEmail(tx, deps.key, { to: v.email, kind: "return.requested", payload: { number: created.number, order: o.number, lines: list.join("\n") } });
    await audit(tx, { actorKind: "CUSTOMER", actorUserId: v.userId, actorLabel: v.name, action: "return.requested", summary: `Asked to return ${chosen.reduce((s, c) => s + c.quantity, 0)} ${chosen.length === 1 && chosen[0].quantity === 1 ? "item" : "items"} from order ${o.number} as ${created.number}: ${RETURN_REASON_LABEL[reason].toLowerCase()}, asking for ${RETURN_WANTS_LABEL[wants].toLowerCase()}`, organisationId: o.organisationId, subjectUserId: v.userId, targetType: "ReturnRequest", targetId: created.id, visibleToCustomer: true, ipAddress: ip });
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

/** Once approved, the customer tells us how the items are coming back. */
export async function setInboundTracking(db: PrismaClient, v: PortalViewer, number: string, input: { carrier: string; reference: string }, ip?: string | null) {
  assertPortalCan(v, "buy");
  const carrier = input.carrier.trim().slice(0, 80);
  const reference = input.reference.trim().slice(0, 80);
  if (!carrier && !reference) throw new DomainError("invalid", "Enter the courier or the tracking number.", "reference");
  await db.$transaction(async (tx) => {
    const r = await tx.returnRequest.findUnique({ where: { number } });
    if (!r || !inScope(v, r)) throw new DomainError("not-found", "No such return.");
    if (r.status !== "APPROVED") throw new DomainError("conflict", "We only need this while the items are on their way to us.");
    await tx.returnRequest.update({ where: { id: r.id }, data: { inboundCarrier: carrier, inboundReference: reference } });
    await audit(tx, { actorKind: "CUSTOMER", actorUserId: v.userId, actorLabel: v.name, action: "return.tracking", summary: `Sent return ${r.number} back${carrier ? ` with ${carrier}` : ""}${reference ? `, tracking ${reference}` : ""}`, organisationId: r.organisationId, subjectUserId: v.userId, targetType: "ReturnRequest", targetId: r.id, visibleToCustomer: true, ipAddress: ip });
  });
}

const RETURN_INCLUDE = {
  order: { select: { id: true, number: true, email: true, name: true, organisationId: true, userId: true, currency: true, pricesIncludeTax: true, taxRateBps: true, invoice: { select: { number: true } }, market: { select: { locale: true, timeZone: true } }, organisation: { select: { name: true } } } },
  lines: { include: { orderLine: { select: { description: true, mpn: true, quantity: true, unitPriceMinor: true } }, units: { include: { unit: { select: { id: true, serial: true, status: true, startsAt: true, endsAt: true, warrantyMonths: true, replacedBy: { select: { serial: true } } } } } } } },
  creditNote: { select: { number: true, totalMinor: true, currency: true, issuedAt: true } },
} satisfies Prisma.ReturnRequestInclude;

export type FullReturn = Prisma.ReturnRequestGetPayload<{ include: typeof RETURN_INCLUDE }>;

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
  return db.returnRequest.count({ where: { status: { in: OPEN } } });
}

/** What crediting a whole return would come to. */
export function returnCredit(r: Pick<FullReturn, "order" | "lines">) {
  return creditFor(r.order, r.lines.map((l) => ({ description: l.orderLine.description, mpn: l.orderLine.mpn, quantity: l.quantity, unitPriceMinor: l.orderLine.unitPriceMinor })));
}

export type ReturnStep = "approve" | "decline" | "receive" | "repair" | "repaired" | "replace" | "credit" | "close";

const STEP: Record<ReturnStep, { from: ReturnStatus[]; to: ReturnStatus; email: string; done: string; verb: string }> = {
  approve: { from: ["REQUESTED"], to: "APPROVED", email: "return.approved", done: "Approved", verb: "approved" },
  decline: { from: ["REQUESTED", "APPROVED"], to: "DECLINED", email: "return.declined", done: "Declined", verb: "declined" },
  receive: { from: ["APPROVED"], to: "RECEIVED", email: "return.received", done: "Received the items for", verb: "received" },
  repair: { from: ["RECEIVED"], to: "IN_REPAIR", email: "return.repairing", done: "Started the repair for", verb: "sent for repair" },
  repaired: { from: ["RECEIVED", "IN_REPAIR"], to: "CLOSED", email: "return.sent-back", done: "Repaired and sent back the items for", verb: "sent back repaired" },
  replace: { from: ["RECEIVED", "IN_REPAIR"], to: "CLOSED", email: "return.replaced", done: "Sent a replacement for", verb: "replaced" },
  credit: { from: ["RECEIVED", "IN_REPAIR"], to: "CLOSED", email: "", done: "Credited", verb: "credited" },
  close: { from: ["RECEIVED", "IN_REPAIR"], to: "CLOSED", email: "return.closed", done: "Settled", verb: "settled" },
};

export interface StepInput {
  /** Shown to the customer. */
  note: string;
  carrier?: string;
  reference?: string;
  /** Internal: the maker's or supplier's repair reference. */
  supplierReference?: string;
  /** For a replacement: the new serial number, by the id of the unit it replaces. */
  replacements?: Record<string, string>;
}

/** Moves a return on, tells the customer, and records it in their history. */
export async function advanceReturn(db: PrismaClient, actor: StaffActor, deps: ReturnDeps, id: string, step: ReturnStep, input: StepInput, ip?: string | null) {
  const s = STEP[step];
  if (!s) throw new DomainError("invalid", "Choose what to do.");
  assertStaffCan(actor, step === "credit" ? "issueCreditNotes" : "manageReturns");
  const now = deps.now ?? new Date();
  const note = input.note.trim().slice(0, 1000);
  const carrier = (input.carrier ?? "").trim().slice(0, 80);
  const reference = (input.reference ?? "").trim().slice(0, 80);
  if (step === "decline" && note.length < 3) throw new DomainError("invalid", "Say why, for the customer.", "note");
  if (step === "close" && note.length < 3) throw new DomainError("invalid", "Say how it was settled, for the customer.", "note");
  if ((step === "repaired" || step === "replace") && !carrier && !reference) throw new DomainError("invalid", "Enter how it goes back: the courier, the tracking number, or both.", "reference");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ReturnRequest" WHERE id = ${id} FOR UPDATE`;
    const r = await tx.returnRequest.findUnique({ where: { id }, include: RETURN_INCLUDE });
    if (!r) throw new DomainError("not-found", "No such return.");
    if (!s.from.includes(r.status)) throw new DomainError("conflict", `This return is ${RETURN_STATUS_LABEL[r.status].toLowerCase()}, so it can't be ${s.verb} now.`);
    const unitIds = r.lines.flatMap((l) => l.units.map((u) => u.unit.id));
    const data: Prisma.ReturnRequestUpdateManyMutationInput = { status: s.to, ...(note ? { note } : {}) };
    let extra: Record<string, string> = {};
    if (step === "approve" || step === "decline") Object.assign(data, { decidedAt: now, decidedByLabel: actor.name });
    if (step === "receive") {
      data.receivedAt = now;
      if (unitIds.length) await tx.unit.updateMany({ where: { id: { in: unitIds } }, data: { status: "IN_REPAIR" } });
    }
    if (step === "repair") Object.assign(data, { repairStartedAt: now, supplierReference: (input.supplierReference ?? "").trim().slice(0, 120) });
    if (step === "repaired" || step === "replace" || step === "close") Object.assign(data, { closedAt: now, outcome: step === "repaired" ? "REPAIR" : step === "replace" ? "REPLACEMENT" : "OTHER", ...(carrier || reference ? { outboundCarrier: carrier, outboundReference: reference, sentBackAt: now } : {}) });
    if (step === "repaired" || step === "close") {
      if (unitIds.length) await tx.unit.updateMany({ where: { id: { in: unitIds } }, data: { status: "WITH_CUSTOMER" } });
    }
    if (step === "replace") {
      const errors: Record<string, string> = {};
      const fresh: { old: (typeof r.lines)[number]["units"][number]["unit"]; serial: string; lineId: string }[] = [];
      const seen = new Set<string>();
      for (const l of r.lines)
        for (const { unit } of l.units) {
          const serial = (input.replacements?.[unit.id] ?? "").trim();
          const key = serialKey(serial);
          if (!key || serial.length > 60) errors[`replace-${unit.id}`] = `Enter the serial number of the unit replacing ${unit.serial}.`;
          else if (seen.has(key) || key === serialKey(unit.serial)) errors[`replace-${unit.id}`] = "Enter a different serial number.";
          else {
            seen.add(key);
            fresh.push({ old: unit, serial, lineId: l.orderLineId });
          }
        }
      if (Object.keys(errors).length) throw new DomainError("invalid", "Check the highlighted fields.", undefined, errors);
      for (const f of fresh) {
        const old = await tx.unit.findUniqueOrThrow({ where: { id: f.old.id } });
        const clash = await tx.unit.findUnique({ where: { orderLineId_serialKey: { orderLineId: f.lineId, serialKey: serialKey(f.serial) } }, select: { id: true } });
        if (clash) throw new DomainError("invalid", "Check the highlighted fields.", undefined, { [`replace-${f.old.id}`]: "This serial number is already on this order." });
        // The replacement carries on the original's warranty; it does not start a new one.
        const made = await tx.unit.create({ data: { serial: f.serial, serialKey: serialKey(f.serial), orderId: old.orderId, orderLineId: old.orderLineId, productId: old.productId, userId: old.userId, organisationId: old.organisationId, description: old.description, mpn: old.mpn, warrantyMonths: old.warrantyMonths, warrantyTerms: old.warrantyTerms, startsAt: now, endsAt: old.endsAt, source: "replacement" } });
        await tx.unit.update({ where: { id: old.id }, data: { status: "REPLACED", replacedById: made.id } });
      }
      extra = { serials: fresh.map((f) => `${f.old.serial} replaced by ${f.serial}`).join("\n") };
    }
    if (step === "credit") {
      const c = returnCredit(r);
      Object.assign(data, { closedAt: now, outcome: "CREDIT" });
      if (unitIds.length) await tx.unit.updateMany({ where: { id: { in: unitIds } }, data: { status: "RETURNED" } });
      await issueCreditNote(tx, deps.key, { orderId: r.orderId, returnId: r.id, lines: c.lines, totalMinor: c.totalMinor, taxMinor: c.taxMinor, reason: note || `Items returned under ${r.number}: ${RETURN_REASON_LABEL[r.reason].toLowerCase()}.`, actor, now });
    }
    const n = await tx.returnRequest.updateMany({ where: { id, status: r.status }, data });
    if (n.count !== 1) throw new DomainError("conflict", "Someone else has just changed this return. Look again.");
    if (s.email) {
      const user = r.userId ? await tx.user.findUnique({ where: { id: r.userId }, select: { email: true } }) : null;
      await queueEmail(tx, deps.key, { to: user?.email ?? r.order.email, kind: s.email, payload: { number: r.number, order: r.order.number, note, carrier, reference, ...extra } });
    }
    const how = carrier || reference ? ` with ${[carrier, reference].filter(Boolean).join(", ")}` : "";
    await audit(tx, staffAudit(actor, { action: `return.${step}`, summary: `${s.done} return ${r.number} for order ${r.order.number}${how}${note ? `: ${note}` : ""}`, organisationId: r.organisationId, subjectUserId: r.userId, targetType: "ReturnRequest", targetId: id, ipAddress: ip, visibleToCustomer: true }));
  });
}
