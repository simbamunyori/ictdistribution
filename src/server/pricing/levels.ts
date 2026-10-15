import type { CustomerTypeCode, PrismaClient } from "@prisma/client";
import { audit, staffAudit } from "@/server/audit";
import { DomainError } from "@/server/errors";
import { assertStaffCan, type StaffActor } from "@/server/staff/access";

/**
 * The rules under each price level (customer type): a different markup
 * for some categories, and volume breaks. Set at /admin/customer-types.
 * A category's markup also covers the categories under it, unless they
 * have their own.
 */

export async function levelRules(db: Pick<PrismaClient, "categoryMarkup" | "volumeBreak">, type: CustomerTypeCode) {
  const [markups, breaks] = await Promise.all([
    db.categoryMarkup.findMany({ where: { customerType: type }, include: { category: { select: { name: true, parent: { select: { name: true } } } } }, orderBy: { category: { name: "asc" } } }),
    db.volumeBreak.findMany({ where: { customerType: type }, include: { category: { select: { name: true } } }, orderBy: [{ minQuantity: "asc" }] }),
  ]);
  return { markups, breaks };
}

function percent(input: string, field: string, max: number) {
  const n = Number(input.trim().replace(/%$/, ""));
  if (!input.trim() || !Number.isFinite(n) || n < 0 || n > max) throw new DomainError("invalid", `Enter a percentage from 0 to ${max}.`, field);
  return Math.round(n * 100);
}

async function typeName(db: Pick<PrismaClient, "customerType">, type: CustomerTypeCode) {
  return (await db.customerType.findUniqueOrThrow({ where: { code: type } })).name;
}

export async function setCategoryMarkup(db: PrismaClient, actor: StaffActor, type: CustomerTypeCode, categoryId: string, markupPercent: string, ip?: string | null) {
  assertStaffCan(actor, "managePriceLevels");
  const markupBps = percent(markupPercent, "markupPercent", 500);
  const category = await db.category.findUnique({ where: { id: categoryId } });
  if (!category) throw new DomainError("invalid", "Choose a category.", "categoryId");
  const name = await typeName(db, type);
  await db.$transaction(async (tx) => {
    const before = await tx.categoryMarkup.findUnique({ where: { customerType_categoryId: { customerType: type, categoryId } } });
    await tx.categoryMarkup.upsert({ where: { customerType_categoryId: { customerType: type, categoryId } }, create: { customerType: type, categoryId, markupBps }, update: { markupBps } });
    await audit(tx, staffAudit(actor, { action: "price-level.category-markup", summary: `${name} markup on ${category.name}: ${before ? `${before.markupBps / 100}% to ` : ""}${markupBps / 100}%`, targetType: "CustomerType", targetId: type, ipAddress: ip }));
  });
}

export async function removeCategoryMarkup(db: PrismaClient, actor: StaffActor, id: string, ip?: string | null) {
  assertStaffCan(actor, "managePriceLevels");
  await db.$transaction(async (tx) => {
    const m = await tx.categoryMarkup.findUnique({ where: { id }, include: { category: { select: { name: true } }, type: { select: { name: true } } } });
    if (!m) return;
    await tx.categoryMarkup.delete({ where: { id } });
    await audit(tx, staffAudit(actor, { action: "price-level.category-markup-removed", summary: `${m.type.name} markup on ${m.category.name} now follows the level's own`, targetType: "CustomerType", targetId: m.customerType, ipAddress: ip }));
  });
}

export async function addVolumeBreak(db: PrismaClient, actor: StaffActor, type: CustomerTypeCode, input: { minQuantity: string; discountPercent: string; categoryId: string }, ip?: string | null) {
  assertStaffCan(actor, "managePriceLevels");
  const fieldErrors: Record<string, string> = {};
  const minQuantity = Number(input.minQuantity);
  if (!Number.isInteger(minQuantity) || minQuantity < 2 || minQuantity > 100_000) fieldErrors.minQuantity = "Enter a whole number from 2.";
  let discountBps = 0;
  try {
    discountBps = percent(input.discountPercent, "discountPercent", 50);
    if (discountBps <= 0) fieldErrors.discountPercent = "Enter a percentage from 0.01 to 50.";
  } catch (e) {
    fieldErrors.discountPercent = (e as Error).message;
  }
  const categoryId = input.categoryId || null;
  const category = categoryId ? await db.category.findUnique({ where: { id: categoryId } }) : null;
  if (categoryId && !category) fieldErrors.categoryId = "Choose a category.";
  if (Object.keys(fieldErrors).length) throw new DomainError("invalid", "Check the highlighted fields.", undefined, fieldErrors);
  const name = await typeName(db, type);
  await db.$transaction(async (tx) => {
    if (await tx.volumeBreak.findFirst({ where: { customerType: type, categoryId, minQuantity } })) throw new DomainError("conflict", "There is already a break at that quantity. Remove it first.", "minQuantity");
    const b = await tx.volumeBreak.create({ data: { customerType: type, categoryId, minQuantity, discountBps } });
    await audit(tx, staffAudit(actor, { action: "price-level.volume-break", summary: `${name}: ${minQuantity} or more ${category ? `in ${category.name}` : "of a product"}, ${discountBps / 100}% off`, targetType: "VolumeBreak", targetId: b.id, ipAddress: ip }));
  });
}

export async function removeVolumeBreak(db: PrismaClient, actor: StaffActor, id: string, ip?: string | null) {
  assertStaffCan(actor, "managePriceLevels");
  await db.$transaction(async (tx) => {
    const b = await tx.volumeBreak.findUnique({ where: { id }, include: { type: { select: { name: true } } } });
    if (!b) return;
    await tx.volumeBreak.delete({ where: { id } });
    await audit(tx, staffAudit(actor, { action: "price-level.volume-break-removed", summary: `${b.type.name}: removed the break at ${b.minQuantity}`, targetType: "VolumeBreak", targetId: id, ipAddress: ip }));
  });
}
