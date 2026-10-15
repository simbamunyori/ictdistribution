import type { PrismaClient } from "@prisma/client";
import { formatMoney, parseMoney } from "@/lib/money";
import { audit, staffAudit } from "@/server/audit";
import { DomainError } from "@/server/errors";
import { assertStaffCan, type StaffActor } from "@/server/staff/access";

/**
 * Prices agreed with one business for one product, in its market's
 * currency and including tax. They replace the price level's price for
 * that customer until they expire; a special that is lower still wins.
 */

export async function customerPricesFor(db: Pick<PrismaClient, "customerPrice">, organisationId: string) {
  return db.customerPrice.findMany({
    where: { organisationId },
    include: { product: { select: { id: true, name: true, mpn: true, brand: { select: { name: true } } } }, market: { select: { currency: true, locale: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export interface CustomerPriceInput {
  productId: string;
  price: string;
  /** yyyy-mm-dd, or empty for no end. */
  validUntil: string;
  note: string;
}

export async function setCustomerPrice(db: PrismaClient, actor: StaffActor, organisationId: string, input: CustomerPriceInput, ip?: string | null, now = new Date()) {
  assertStaffCan(actor, "manageCustomerPrices");
  const org = await db.organisation.findUnique({ where: { id: organisationId }, include: { market: true } });
  if (!org) throw new DomainError("not-found", "No such customer.");
  const product = await db.product.findUnique({ where: { id: input.productId }, select: { id: true, name: true, status: true } });
  if (!product) throw new DomainError("invalid", "Choose the product.", "product");
  const fieldErrors: Record<string, string> = {};
  let priceMinor = 0n;
  try {
    priceMinor = parseMoney(input.price, org.market.currency);
    if (priceMinor <= 0n) throw new Error();
  } catch {
    fieldErrors.price = `Enter the price in ${org.market.currency}, including ${org.market.taxName}.`;
  }
  let validUntil: Date | null = null;
  if (input.validUntil.trim()) {
    validUntil = /^\d{4}-\d{2}-\d{2}$/.test(input.validUntil) ? new Date(`${input.validUntil}T23:59:59Z`) : null;
    if (!validUntil || Number.isNaN(validUntil.getTime()) || validUntil <= now) fieldErrors.validUntil = "Enter a date in the future, or leave it empty.";
  }
  const note = input.note.trim();
  if (note.length > 200) fieldErrors.note = "Keep it under 200 characters.";
  if (Object.keys(fieldErrors).length) throw new DomainError("invalid", "Check the highlighted fields.", undefined, fieldErrors);
  await db.$transaction(async (tx) => {
    const key = { organisationId_productId_marketCode: { organisationId, productId: product.id, marketCode: org.marketCode } };
    await tx.customerPrice.upsert({ where: key, create: { organisationId, productId: product.id, marketCode: org.marketCode, priceMinor, validUntil, note, createdByLabel: actor.name }, update: { priceMinor, validUntil, note, createdByLabel: actor.name } });
    await audit(tx, staffAudit(actor, { organisationId, visibleToCustomer: true, action: "customer-price.set", summary: `Agreed ${formatMoney({ amountMinor: priceMinor, currency: org.market.currency }, org.market.locale)} for ${product.name}`, targetType: "Product", targetId: product.id, ipAddress: ip }));
  });
}

export async function removeCustomerPrice(db: PrismaClient, actor: StaffActor, id: string, ip?: string | null) {
  assertStaffCan(actor, "manageCustomerPrices");
  await db.$transaction(async (tx) => {
    const p = await tx.customerPrice.findUnique({ where: { id }, include: { product: { select: { name: true } } } });
    if (!p) return;
    await tx.customerPrice.delete({ where: { id } });
    await audit(tx, staffAudit(actor, { organisationId: p.organisationId, visibleToCustomer: true, action: "customer-price.removed", summary: `Ended the agreed price for ${p.product.name}`, targetType: "Product", targetId: p.productId, ipAddress: ip }));
  });
}
