import type { Prisma, PrismaClient } from "@prisma/client";
import { audit, staffAudit } from "@/server/audit";
import { DomainError } from "@/server/errors";
import { assertStaffCan, type StaffActor } from "@/server/staff/access";
import { logisticsSettings } from "./landed";

/**
 * Our warehouses and what is in them. Each product's level keeps what is
 * on hand and how much of it is kept for orders. Every change is a
 * movement: received, kept for an order line (or let go), issued on a
 * delivery, or a count by staff.
 */

type Tx = Prisma.TransactionClient;

const COUNTRY = /^[A-Z]{2}$/;

// ─── Warehouses ──────────────────────────────────────────────────────

export async function listWarehouses(db: Pick<PrismaClient, "warehouse" | "logisticsSettings">) {
  const [list, s] = await Promise.all([db.warehouse.findMany({ orderBy: [{ active: "desc" }, { code: "asc" }], include: { _count: { select: { stock: true } } } }), logisticsSettings(db)]);
  return list.map((w) => ({ ...w, isDefault: w.id === s.defaultWarehouseId }));
}

/** The warehouse goods are bought into and sent from: the default one, when it is switched on. */
export async function defaultWarehouse(db: Pick<PrismaClient, "warehouse" | "logisticsSettings"> | Tx) {
  const s = await logisticsSettings(db);
  if (!s.defaultWarehouseId) return null;
  return db.warehouse.findFirst({ where: { id: s.defaultWarehouseId, active: true } });
}

export interface WarehouseInput {
  code: string;
  name: string;
  country: string;
  address: string;
  active: boolean;
  isDefault: boolean;
}

export async function saveWarehouse(db: PrismaClient, actor: StaffActor, id: string | null, input: WarehouseInput, ip?: string | null) {
  assertStaffCan(actor, "manageStock");
  const code = input.code.trim().toUpperCase();
  const name = input.name.trim();
  const country = input.country.trim().toUpperCase();
  const address = input.address.trim();
  const errors: Record<string, string> = {};
  if (!/^[A-Z0-9-]{2,12}$/.test(code)) errors.code = "Use 2 to 12 letters, digits or dashes.";
  if (name.length < 2 || name.length > 80) errors.name = "Enter a name of up to 80 characters.";
  if (!COUNTRY.test(country)) errors.country = "Enter the two-letter country code, such as BW.";
  if (address.length > 500) errors.address = "Keep it under 500 characters.";
  if (input.isDefault && !input.active) errors.active = "The default warehouse must be switched on.";
  if (Object.keys(errors).length) throw new DomainError("invalid", "Check the highlighted fields.", undefined, errors);
  return db.$transaction(async (tx) => {
    const clash = await tx.warehouse.findUnique({ where: { code }, select: { id: true } });
    if (clash && clash.id !== id) throw new DomainError("invalid", "Another warehouse has this code.", "code");
    const s = await logisticsSettings(tx);
    if (id && !input.active && s.defaultWarehouseId === id) throw new DomainError("invalid", "Make another warehouse the default before switching this one off.", "active");
    const data = { code, name, country, address, active: input.active };
    const w = id ? await tx.warehouse.update({ where: { id }, data }) : await tx.warehouse.create({ data });
    if (input.isDefault && s.defaultWarehouseId !== w.id) await tx.logisticsSettings.update({ where: { id: "global" }, data: { defaultWarehouseId: w.id } });
    await audit(tx, staffAudit(actor, { action: id ? "warehouse.updated" : "warehouse.created", summary: `${id ? "Changed" : "Added"} warehouse ${code}, ${name}${input.isDefault ? ", the default" : ""}${input.active ? "" : ", switched off"}`, targetType: "Warehouse", targetId: w.id, ipAddress: ip }));
    return w;
  });
}

// ─── Levels ──────────────────────────────────────────────────────────

export async function listStock(db: Pick<PrismaClient, "stockLevel">, f: { warehouseId?: string; q?: string } = {}) {
  const q = f.q?.trim();
  return db.stockLevel.findMany({
    where: { ...(f.warehouseId ? { warehouseId: f.warehouseId } : {}), ...(q ? { product: { OR: [{ name: { contains: q, mode: "insensitive" } }, { mpn: { contains: q, mode: "insensitive" } }] } } : {}) },
    orderBy: [{ warehouse: { code: "asc" } }, { product: { name: "asc" } }],
    take: 500,
    include: { warehouse: { select: { code: true, name: true } }, product: { select: { id: true, name: true, mpn: true, brand: { select: { name: true } } } } },
  });
}

export async function stockMovements(db: Pick<PrismaClient, "stockMovement">, warehouseId: string, productId: string) {
  return db.stockMovement.findMany({ where: { warehouseId, productId }, orderBy: { at: "desc" }, take: 100, include: { orderLine: { select: { order: { select: { id: true, number: true } } } } } });
}

/** Locks a product's level in a warehouse, making it when there is none. */
async function lockLevel(tx: Tx, warehouseId: string, productId: string) {
  await tx.stockLevel.upsert({ where: { warehouseId_productId: { warehouseId, productId } }, create: { warehouseId, productId }, update: {} });
  await tx.$queryRaw`SELECT id FROM "StockLevel" WHERE "warehouseId" = ${warehouseId} AND "productId" = ${productId} FOR UPDATE`;
  return tx.stockLevel.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId, productId } } });
}

/** Staff counted it: the level becomes what they counted. A count below what is kept for orders is refused. */
export async function countStock(db: PrismaClient, actor: StaffActor, warehouseId: string, productId: string, countInput: string, noteInput: string, ip?: string | null) {
  assertStaffCan(actor, "manageStock");
  const count = /^\d{1,7}$/.test(countInput.trim()) ? Number(countInput.trim()) : NaN;
  if (!Number.isInteger(count)) throw new DomainError("invalid", "Enter how many you counted.", "count");
  const note = noteInput.trim().slice(0, 300);
  await db.$transaction(async (tx) => {
    const [w, p] = await Promise.all([tx.warehouse.findUnique({ where: { id: warehouseId } }), tx.product.findUnique({ where: { id: productId }, select: { name: true } })]);
    if (!w || !p) throw new DomainError("not-found", "No such warehouse or product.");
    const level = await lockLevel(tx, warehouseId, productId);
    if (count < level.allocated) throw new DomainError("invalid", `${level.allocated} are kept for orders. Count at least that many, or let the orders go first.`, "count");
    const change = count - level.onHand;
    if (!change) return;
    await tx.stockLevel.update({ where: { id: level.id }, data: { onHand: count } });
    await tx.stockMovement.create({ data: { warehouseId, productId, kind: "ADJUSTED", quantity: change, note, byLabel: actor.name } });
    await audit(tx, staffAudit(actor, { action: "stock.counted", summary: `Counted ${count} of ${p.name} in ${w.code} (${change > 0 ? "+" : ""}${change})${note ? `: ${note}` : ""}`, targetType: "Warehouse", targetId: warehouseId, ipAddress: ip }));
  });
}

/** Keeps free stock for an order line. False when there isn't enough free. */
export async function allocateFromStock(tx: Tx, warehouseId: string, productId: string, orderLineId: string, quantity: number, byLabel: string): Promise<boolean> {
  if (quantity <= 0) return false;
  const existing = await tx.stockLevel.findUnique({ where: { warehouseId_productId: { warehouseId, productId } }, select: { onHand: true, allocated: true } });
  if (!existing || existing.onHand - existing.allocated < quantity) return false;
  const level = await lockLevel(tx, warehouseId, productId);
  if (level.onHand - level.allocated < quantity) return false;
  await tx.stockLevel.update({ where: { id: level.id }, data: { allocated: { increment: quantity } } });
  await tx.stockMovement.create({ data: { warehouseId, productId, kind: "ALLOCATED", quantity, orderLineId, byLabel } });
  return true;
}

/** Goods from a purchase order arrived: they go on hand, and are kept for the order lines they were bought for. */
export async function receiveIntoStock(tx: Tx, warehouseId: string, purchaseOrderId: string, lines: { productId: string | null; orderLineId: string | null; quantity: number }[], byLabel: string) {
  for (const l of lines) {
    if (!l.productId || l.quantity <= 0) continue;
    const level = await lockLevel(tx, warehouseId, l.productId);
    await tx.stockLevel.update({ where: { id: level.id }, data: { onHand: { increment: l.quantity }, ...(l.orderLineId ? { allocated: { increment: l.quantity } } : {}) } });
    await tx.stockMovement.create({ data: { warehouseId, productId: l.productId, kind: "RECEIVED", quantity: l.quantity, purchaseOrderId, orderLineId: l.orderLineId, byLabel } });
    if (l.orderLineId) await tx.stockMovement.create({ data: { warehouseId, productId: l.productId, kind: "ALLOCATED", quantity: l.quantity, purchaseOrderId, orderLineId: l.orderLineId, byLabel } });
  }
}

/** What is still kept for each order line, by warehouse and product: kept less let go and issued. */
export async function keptFor(tx: Tx | Pick<PrismaClient, "stockMovement">, orderLineIds: string[]) {
  if (!orderLineIds.length) return [];
  const rows = await tx.stockMovement.groupBy({ by: ["orderLineId", "warehouseId", "productId"], where: { orderLineId: { in: orderLineIds }, kind: { in: ["ALLOCATED", "ISSUED"] } }, _sum: { quantity: true } });
  return rows.map((r) => ({ orderLineId: r.orderLineId!, warehouseId: r.warehouseId, productId: r.productId, kept: r._sum.quantity ?? 0 })).filter((r) => r.kept > 0);
}

/**
 * Takes the goods for a delivery out of stock. Part of a line takes its
 * share of what is kept for it; the last of it takes the rest.
 */
export async function issueForDelivery(tx: Tx, lines: { orderLineId: string; quantity: number; remaining: number }[], byLabel: string) {
  const kept = await keptFor(tx, lines.map((l) => l.orderLineId));
  for (const k of kept) {
    const l = lines.find((x) => x.orderLineId === k.orderLineId)!;
    const units = l.quantity >= l.remaining ? k.kept : Math.min(k.kept, Math.ceil((k.kept * l.quantity) / Math.max(1, l.remaining)));
    if (units <= 0) continue;
    const level = await lockLevel(tx, k.warehouseId, k.productId);
    await tx.stockLevel.update({ where: { id: level.id }, data: { onHand: Math.max(0, level.onHand - units), allocated: Math.max(0, level.allocated - units) } });
    await tx.stockMovement.create({ data: { warehouseId: k.warehouseId, productId: k.productId, kind: "ISSUED", quantity: -units, orderLineId: k.orderLineId, byLabel } });
  }
}

/** The order was cancelled: what was kept for it is free again. */
export async function releaseForOrder(tx: Tx, orderId: string, byLabel: string) {
  const lines = await tx.orderLine.findMany({ where: { orderId }, select: { id: true } });
  for (const k of await keptFor(tx, lines.map((l) => l.id))) {
    const level = await lockLevel(tx, k.warehouseId, k.productId);
    await tx.stockLevel.update({ where: { id: level.id }, data: { allocated: Math.max(0, level.allocated - k.kept) } });
    await tx.stockMovement.create({ data: { warehouseId: k.warehouseId, productId: k.productId, kind: "ALLOCATED", quantity: -k.kept, orderLineId: k.orderLineId, note: "Order cancelled", byLabel } });
  }
}
