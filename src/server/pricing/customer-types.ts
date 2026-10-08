import type { CustomerType, CustomerTypeCode, PrismaClient } from "@prisma/client";
import { audit, staffAudit } from "@/server/audit";
import { DomainError } from "@/server/errors";
import { assertStaffCan, type StaffActor } from "@/server/staff/access";

/**
 * The four customer types and their price levels. Individuals buy as
 * themselves; the other three are organisations. The markup on each is
 * set at /admin/customer-types; D4 adds markups by category, volume
 * breaks and per-customer prices on top.
 */

export const ORGANISATION_TYPES: CustomerTypeCode[] = ["BUSINESS", "RESELLER", "GOVERNMENT"];

export async function listCustomerTypes(db: Pick<PrismaClient, "customerType">) {
  return db.customerType.findMany({ orderBy: { sortOrder: "asc" } });
}

export async function customerType(db: Pick<PrismaClient, "customerType">, code: CustomerTypeCode): Promise<CustomerType> {
  return db.customerType.findUniqueOrThrow({ where: { code } });
}

/** The price level for whoever is buying: their organisation's type, or Individual. */
export async function priceLevelFor(db: Pick<PrismaClient, "customerType" | "organisation">, organisationId: string | null): Promise<CustomerType> {
  if (!organisationId) return customerType(db, "INDIVIDUAL");
  const org = await db.organisation.findUniqueOrThrow({ where: { id: organisationId }, select: { customerType: true } });
  return customerType(db, org.customerType);
}

/** Whether individuals may check out without an account (the checkout itself comes in D3). */
export async function guestCheckoutAllowed(db: Pick<PrismaClient, "customerType">): Promise<boolean> {
  return (await customerType(db, "INDIVIDUAL")).guestCheckout;
}

export interface CustomerTypeInput {
  name: string;
  description: string;
  /** Entered as a percentage, e.g. "25" or "12.5". */
  markupPercent: number;
  guestCheckout: boolean;
}

export async function updateCustomerType(db: PrismaClient, actor: StaffActor, code: CustomerTypeCode, input: CustomerTypeInput, ip?: string | null): Promise<CustomerType> {
  assertStaffCan(actor, "managePriceLevels");
  const name = input.name.trim();
  const description = input.description.trim();
  const fieldErrors: Record<string, string> = {};
  if (name.length < 2 || name.length > 40) fieldErrors.name = "Enter a name of 2 to 40 characters.";
  if (description.length > 200) fieldErrors.description = "Keep it under 200 characters.";
  if (!Number.isFinite(input.markupPercent) || input.markupPercent < 0 || input.markupPercent > 500) fieldErrors.markupPercent = "Enter a percentage from 0 to 500.";
  if (Object.keys(fieldErrors).length) throw new DomainError("invalid", "Check the highlighted fields.", undefined, fieldErrors);
  const markupBps = Math.round(input.markupPercent * 100);

  return db.$transaction(async (tx) => {
    const before = await tx.customerType.findUniqueOrThrow({ where: { code } });
    const guestCheckout = code === "INDIVIDUAL" ? input.guestCheckout : false;
    const after = await tx.customerType.update({ where: { code }, data: { name, description, markupBps, guestCheckout } });
    const changes: string[] = [];
    if (before.markupBps !== markupBps) changes.push(`markup ${(before.markupBps / 100).toFixed(2)}% to ${(markupBps / 100).toFixed(2)}%`);
    if (before.name !== name) changes.push(`name to ${name}`);
    if (before.description !== description) changes.push("description");
    if (before.guestCheckout !== guestCheckout) changes.push(guestCheckout ? "guest checkout on" : "guest checkout off");
    if (changes.length) {
      await audit(
        tx,
        staffAudit(actor, {
          action: "customer-type.updated",
          summary: `Changed ${before.name}: ${changes.join(", ")}`,
          targetType: "CustomerType",
          targetId: code,
          data: { from: { name: before.name, markupBps: before.markupBps, guestCheckout: before.guestCheckout }, to: { name, markupBps, guestCheckout } },
          ipAddress: ip,
        }),
      );
    }
    return after;
  });
}
