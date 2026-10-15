import type { Prisma, PrismaClient, UnitStatus } from "@prisma/client";
import { readSerials } from "@/lib/procurement";
import { serialKey, warrantyEnd } from "@/lib/warranty";
import { audit, staffAudit } from "@/server/audit";
import { DomainError } from "@/server/errors";
import { scopeWhere, type PortalViewer } from "@/server/portal/scope";
import { assertStaffCan, type StaffActor } from "@/server/staff/access";

/**
 * Serial and warranty records. Each serial-numbered item sold is a unit:
 * its serial comes from the supplier's shipping notice or is typed by
 * staff on the order, and its warranty starts the day it leaves us, for
 * as long as the product's warranty was when it was sold.
 */

type Tx = Prisma.TransactionClient;

export const UNIT_STATUS_LABEL: Record<UnitStatus, string> = { WITH_CUSTOMER: "With the customer", IN_REPAIR: "In for repair", REPLACED: "Replaced", RETURNED: "Returned and credited" };
export const UNIT_STATUS_TONE = { WITH_CUSTOMER: "neutral", IN_REPAIR: "warning", REPLACED: "neutral", RETURNED: "neutral" } as const;

/** The day each line of an order left us: the order's sent date, or the first delivery the line went in. */
async function sentDates(tx: Tx, orderId: string) {
  const o = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true, fulfilledAt: true, deliveries: { where: { status: { not: "PREPARED" } }, select: { dispatchedAt: true, lines: { select: { orderLineId: true } } } } } });
  const out = new Map<string, Date>();
  for (const d of o.deliveries) {
    if (!d.dispatchedAt) continue;
    for (const l of d.lines) {
      const was = out.get(l.orderLineId);
      if (!was || d.dispatchedAt < was) out.set(l.orderLineId, d.dispatchedAt);
    }
  }
  return { out, fulfilledAt: o.status === "FULFILLED" ? o.fulfilledAt : null };
}

/**
 * Brings an order's units in line with the serials we hold for it, and
 * starts the warranty of any that have now left us. Call it inside the
 * transaction that changes serials or sends goods. Units already in a
 * return, or replaced, are kept whatever the serials now say.
 */
export async function syncUnits(tx: Tx, orderId: string): Promise<void> {
  const o = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { id: true, userId: true, organisationId: true, lines: { select: { id: true, productId: true, description: true, mpn: true, serials: true, product: { select: { warrantyMonths: true, warrantyTerms: true } } } } },
  });
  if (!o.lines.length) return;
  const lineIds = o.lines.map((l) => l.id);
  const [poLines, existing, sent] = await Promise.all([
    tx.purchaseOrderLine.findMany({ where: { orderLineId: { in: lineIds }, serials: { not: "" }, purchaseOrder: { status: { not: "CANCELLED" } } }, select: { orderLineId: true, serials: true } }),
    tx.unit.findMany({ where: { orderId }, select: { id: true, orderLineId: true, serialKey: true, source: true, status: true, startsAt: true, warrantyMonths: true, _count: { select: { returnUnits: true } } } }),
    sentDates(tx, orderId),
  ]);
  for (const line of o.lines) {
    const wanted = new Map<string, { serial: string; source: string }>();
    for (const s of readSerials(line.serials)) wanted.set(serialKey(s), { serial: s, source: "staff" });
    for (const p of poLines.filter((p) => p.orderLineId === line.id)) for (const s of readSerials(p.serials)) if (!wanted.has(serialKey(s))) wanted.set(serialKey(s), { serial: s, source: "supplier" });
    wanted.delete("");
    const have = existing.filter((u) => u.orderLineId === line.id);
    const stale = have.filter((u) => u.source !== "replacement" && !wanted.has(u.serialKey) && u.status === "WITH_CUSTOMER" && u._count.returnUnits === 0);
    if (stale.length) await tx.unit.deleteMany({ where: { id: { in: stale.map((u) => u.id) } } });
    const keys = new Set(have.map((u) => u.serialKey));
    const startsAt = sent.fulfilledAt ?? sent.out.get(line.id) ?? null;
    const months = line.product?.warrantyMonths ?? null;
    const fresh = [...wanted].filter(([k]) => !keys.has(k));
    if (fresh.length)
      await tx.unit.createMany({
        data: fresh.map(([key, w]) => ({ serial: w.serial.slice(0, 60), serialKey: key.slice(0, 60), orderId: o.id, orderLineId: line.id, productId: line.productId, userId: o.userId, organisationId: o.organisationId, description: line.description, mpn: line.mpn, warrantyMonths: months, warrantyTerms: line.product?.warrantyTerms ?? "", source: w.source, startsAt, endsAt: startsAt ? warrantyEnd(startsAt, months) : null })),
        skipDuplicates: true,
      });
    // Units recorded before the goods left start their warranty now.
    if (startsAt) for (const u of have.filter((u) => !u.startsAt && !stale.includes(u))) await tx.unit.update({ where: { id: u.id }, data: { startsAt, endsAt: warrantyEnd(startsAt, u.warrantyMonths) } });
  }
}

/** Staff type the serial numbers of a line, one per line; for items from our stock or missing from a supplier's notice. */
export async function setLineSerials(db: PrismaClient, actor: StaffActor, orderLineId: string, text: string, ip?: string | null) {
  assertStaffCan(actor, "recordSerials");
  await db.$transaction(async (tx) => {
    const line = await tx.orderLine.findUnique({ where: { id: orderLineId }, select: { id: true, quantity: true, description: true, serials: true, order: { select: { id: true, number: true, status: true, organisationId: true, userId: true } } } });
    if (!line) throw new DomainError("not-found", "No such order line.");
    if (line.order.status === "CANCELLED") throw new DomainError("conflict", "This order was cancelled.");
    const list = readSerials(text);
    if (list.length > line.quantity) throw new DomainError("invalid", `That is ${list.length} serial numbers for ${line.quantity} ${line.quantity === 1 ? "unit" : "units"}.`, "serials");
    if (list.some((s) => s.length > 60 || !serialKey(s))) throw new DomainError("invalid", "A serial number is too long or empty. Put one per line.", "serials");
    const next = list.join("\n");
    if (next === line.serials) return;
    await tx.orderLine.update({ where: { id: line.id }, data: { serials: next } });
    await syncUnits(tx, line.order.id);
    await audit(tx, staffAudit(actor, { action: "order.serials", summary: `Recorded ${list.length} serial ${list.length === 1 ? "number" : "numbers"} for ${line.description} on order ${line.order.number}`, organisationId: line.order.organisationId, subjectUserId: line.order.userId, targetType: "Order", targetId: line.order.id, ipAddress: ip }));
  });
}

// ─── Reading ─────────────────────────────────────────────────────────

const UNIT_INCLUDE = {
  order: { select: { number: true, name: true, email: true, market: { select: { locale: true, timeZone: true } }, organisation: { select: { name: true } } } },
  product: { select: { slug: true } },
  replacedBy: { select: { serial: true } },
  replaces: { select: { serial: true } },
  returnUnits: { orderBy: { returnLine: { request: { createdAt: "desc" } } }, select: { returnLine: { select: { request: { select: { id: true, number: true, status: true, createdAt: true } } } } } },
} satisfies Prisma.UnitInclude;

export type UnitRow = Prisma.UnitGetPayload<{ include: typeof UNIT_INCLUDE }>;

/** The viewer's serial-numbered items, newest first, optionally only those whose serial, product or order matches `q`. */
export async function customerUnits(db: Pick<PrismaClient, "unit">, v: Pick<PortalViewer, "userId" | "organisationId">, q = "") {
  const t = q.trim().slice(0, 80);
  const key = serialKey(t);
  return db.unit.findMany({
    where: { ...scopeWhere(v), ...(t ? { OR: [...(key ? [{ serialKey: { contains: key } }] : []), { description: { contains: t, mode: "insensitive" as const } }, { order: { number: { contains: t, mode: "insensitive" as const } } }] } : {}) },
    orderBy: [{ createdAt: "desc" }, { serial: "asc" }],
    take: 500,
    include: UNIT_INCLUDE,
  });
}

/** Staff look a serial number up, however it is typed, or list the newest. */
export async function findUnits(db: Pick<PrismaClient, "unit">, q = "") {
  const key = serialKey(q.trim().slice(0, 80));
  return db.unit.findMany({ where: key ? { serialKey: { contains: key } } : {}, orderBy: { createdAt: "desc" }, take: 100, include: UNIT_INCLUDE });
}
