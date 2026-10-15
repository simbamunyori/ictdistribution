import type { PrismaClient } from "@prisma/client";
import { DomainError } from "@/server/errors";
import { addToCart, type Shopper } from "@/server/shop/cart";
import { assertPortalCan, inScope, scopeWhere, type PortalViewer } from "./scope";

/**
 * Saved lists and buying again. A list is products and how many of each,
 * saved from a product page, the cart or an order. Putting a list or a
 * past order in the cart prices everything afresh; anything no longer
 * sold is left out and named.
 */

export const MAX_LISTS = 50;
export const MAX_LIST_LINES = 200;

type Db = Pick<PrismaClient, "savedList" | "savedListLine" | "product" | "$transaction">;
type CartDb = Parameters<typeof addToCart>[0];

function cleanName(input: string): string {
  const name = input.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 60) throw new DomainError("invalid", "Name the list in 2 to 60 characters.", "name");
  return name;
}

function cleanQuantity(input: string | number, allowZero = false): number {
  const n = typeof input === "number" ? input : /^\d{1,6}$/.test(input.trim()) ? Number(input.trim()) : NaN;
  if (!Number.isInteger(n) || n < (allowZero ? 0 : 1) || n > 10_000) throw new DomainError("invalid", allowZero ? "Enter a whole number, or 0 to remove it." : "Enter how many, from 1.", "quantity");
  return n;
}

export async function listsFor(db: Pick<PrismaClient, "savedList">, v: Pick<PortalViewer, "userId" | "organisationId">) {
  return db.savedList.findMany({ where: scopeWhere(v), orderBy: { updatedAt: "desc" }, include: { _count: { select: { lines: true } }, user: { select: { name: true } } } });
}

export async function getList(db: Pick<PrismaClient, "savedList">, v: Pick<PortalViewer, "userId" | "organisationId">, id: string) {
  const list = await db.savedList.findUnique({
    where: { id },
    include: { user: { select: { name: true } }, lines: { orderBy: { createdAt: "asc" }, include: { product: { select: { id: true, name: true, slug: true, mpn: true, status: true, brand: { select: { name: true } } } } } } },
  });
  return list && inScope(v, list) ? list : null;
}

async function ownList(db: Pick<PrismaClient, "savedList">, v: PortalViewer, id: string) {
  assertPortalCan(v, "buy");
  const list = await db.savedList.findUnique({ where: { id } });
  if (!list || !inScope(v, list)) throw new DomainError("not-found", "No such list.");
  return list;
}

export async function createList(db: Pick<PrismaClient, "savedList">, v: PortalViewer, nameInput: string) {
  assertPortalCan(v, "buy");
  const name = cleanName(nameInput);
  if ((await db.savedList.count({ where: scopeWhere(v) })) >= MAX_LISTS) throw new DomainError("invalid", `You can keep up to ${MAX_LISTS} lists. Delete one first.`, "name");
  return db.savedList.create({ data: { name, userId: v.userId, organisationId: v.organisationId } });
}

export async function renameList(db: Pick<PrismaClient, "savedList">, v: PortalViewer, id: string, nameInput: string) {
  await ownList(db, v, id);
  await db.savedList.update({ where: { id }, data: { name: cleanName(nameInput) } });
}

export async function deleteList(db: Pick<PrismaClient, "savedList">, v: PortalViewer, id: string) {
  await ownList(db, v, id);
  await db.savedList.delete({ where: { id } });
}

/** Adds products to a list, adding to what is there. */
async function addLines(db: Db, listId: string, items: { productId: string; quantity: number }[]) {
  await db.$transaction(async (tx) => {
    const have = await tx.savedListLine.findMany({ where: { listId }, select: { productId: true } });
    const fresh = new Set(items.map((i) => i.productId).filter((id) => !have.some((h) => h.productId === id)));
    if (have.length + fresh.size > MAX_LIST_LINES) throw new DomainError("invalid", `A list holds up to ${MAX_LIST_LINES} products. Start another list.`);
    for (const i of items) await tx.savedListLine.upsert({ where: { listId_productId: { listId, productId: i.productId } }, create: { listId, productId: i.productId, quantity: Math.min(10_000, i.quantity) }, update: { quantity: { increment: i.quantity } } });
    await tx.$executeRaw`UPDATE "SavedListLine" SET quantity = LEAST(quantity, 10000) WHERE "listId" = ${listId}`;
    await tx.savedList.update({ where: { id: listId }, data: { updatedAt: new Date() } });
  });
}

/** Saves a product to an existing list, or to a new one when `newName` is given. Returns the list. */
export async function saveToList(db: Db, v: PortalViewer, target: { listId?: string; newName?: string }, productId: string, quantityInput: string | number) {
  assertPortalCan(v, "buy");
  const quantity = cleanQuantity(quantityInput);
  const p = await db.product.findUnique({ where: { id: productId }, select: { id: true } });
  if (!p) throw new DomainError("not-found", "No such product.");
  const list = target.newName?.trim() ? await createList(db, v, target.newName) : await ownList(db, v, target.listId ?? "");
  await addLines(db, list.id, [{ productId, quantity }]);
  return list;
}

export async function setListLine(db: Db, v: PortalViewer, lineId: string, quantityInput: string) {
  assertPortalCan(v, "buy");
  const line = await db.savedListLine.findUnique({ where: { id: lineId }, include: { list: true } });
  if (!line || !inScope(v, line.list)) throw new DomainError("not-found", "That item isn't on the list any more.");
  const quantity = cleanQuantity(quantityInput, true);
  if (quantity === 0) await db.savedListLine.delete({ where: { id: lineId } });
  else await db.savedListLine.update({ where: { id: lineId }, data: { quantity } });
}

/** Saves what is in the cart as a new list. Bundles are left out: they are specials that end. */
export async function saveCartAsList(db: Db & Pick<PrismaClient, "cartLine">, v: PortalViewer, cartId: string | null, nameInput: string) {
  assertPortalCan(v, "buy");
  const lines = cartId ? await db.cartLine.findMany({ where: { cartId, productId: { not: null } }, select: { productId: true, quantity: true } }) : [];
  if (!lines.length) throw new DomainError("invalid", "Your cart has no products to save.");
  const list = await createList(db, v, nameInput);
  await addLines(db, list.id, lines.map((l) => ({ productId: l.productId!, quantity: l.quantity })));
  return list;
}

/** Saves an order's products as a new list. */
export async function saveOrderAsList(db: Db & Pick<PrismaClient, "order">, v: PortalViewer, orderNumber: string, nameInput: string) {
  assertPortalCan(v, "buy");
  const o = await db.order.findUnique({ where: { number: orderNumber }, include: { lines: { where: { productId: { not: null } }, orderBy: { sortOrder: "asc" } } } });
  if (!o || !inScope(v, o)) throw new DomainError("not-found", "No such order.");
  const totals = new Map<string, number>();
  for (const l of o.lines) totals.set(l.productId!, (totals.get(l.productId!) ?? 0) + l.quantity);
  if (!totals.size) throw new DomainError("invalid", "This order has no products we still sell.");
  const list = await createList(db, v, nameInput);
  await addLines(db, list.id, [...totals].map(([productId, quantity]) => ({ productId, quantity })));
  return list;
}

export interface ToCart {
  added: number;
  /** What was left out, by name, with why. */
  skipped: string[];
}

async function putInCart(db: CartDb, cartId: string, shopper: Shopper, items: { productId?: string; bundleId?: string; quantity: number; name: string }[]): Promise<ToCart> {
  const out: ToCart = { added: 0, skipped: [] };
  for (const i of items) {
    try {
      await addToCart(db, cartId, { productId: i.productId, bundleId: i.bundleId }, i.quantity, shopper);
      out.added += 1;
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      out.skipped.push(`${i.name}: ${e.message}`);
    }
  }
  return out;
}

/** Puts everything on a list in the cart. Anyone who can see the list may use it to buy, if they can buy. */
export async function listToCart(db: Db & CartDb, v: PortalViewer, listId: string, cartId: string, shopper: Shopper): Promise<ToCart> {
  assertPortalCan(v, "buy");
  const list = await getList(db, v, listId);
  if (!list) throw new DomainError("not-found", "No such list.");
  if (!list.lines.length) throw new DomainError("invalid", "This list is empty.");
  return putInCart(db, cartId, shopper, list.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, name: `${l.product.brand.name} ${l.product.name}` })));
}

/** One click to buy an order again: its products and bundles go in the cart at today's prices. */
export async function reorder(db: CartDb & Pick<PrismaClient, "order">, v: PortalViewer, orderNumber: string, cartId: string, shopper: Shopper): Promise<ToCart> {
  assertPortalCan(v, "buy");
  const o = await db.order.findUnique({ where: { number: orderNumber }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
  if (!o || !inScope(v, o)) throw new DomainError("not-found", "No such order.");
  const items = o.lines.map((l) => (l.bundleId ? { bundleId: l.bundleId, quantity: l.quantity, name: l.specialName ?? l.description } : l.productId ? { productId: l.productId, quantity: l.quantity, name: l.description } : null));
  const out = await putInCart(db, cartId, shopper, items.filter((i) => i !== null));
  for (const l of o.lines) if (!l.productId && !l.bundleId) out.skipped.push(`${l.description}: it was priced for you on a quote. Ask for a new quote.`);
  return out;
}
