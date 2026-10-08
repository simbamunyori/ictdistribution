import type { PrismaClient } from "@prisma/client";
import { audit, staffAudit } from "@/server/audit";
import { DomainError } from "@/server/errors";
import { assertStaffCan, type StaffActor } from "@/server/staff/access";

/**
 * Finance settings, edited by Admin and Finance in /admin/finance/settings:
 * when overdue invoices are chased, and the account and tax codes the
 * accounting export uses.
 */

export async function financeSettings(db: Pick<PrismaClient, "financeSettings">) {
  return db.financeSettings.upsert({
    where: { id: "global" },
    create: { id: "global" },
    update: {},
  });
}

export interface FinanceSettingsInput {
  remindersOn: boolean;
  firstReminderDays: string;
  reminderEveryDays: string;
  maxReminders: string;
  salesAccountCode: string;
  taxCode: string;
  zeroTaxCode: string;
  cashAccountCode: string;
  bankAccountCode: string;
}

export async function financeSettingsForm(db: Pick<PrismaClient, "financeSettings">) {
  const s = await financeSettings(db);
  return {
    remindersOn: s.remindersOn,
    firstReminderDays: String(s.firstReminderDays),
    reminderEveryDays: String(s.reminderEveryDays),
    maxReminders: String(s.maxReminders),
    salesAccountCode: s.salesAccountCode,
    taxCode: s.taxCode,
    zeroTaxCode: s.zeroTaxCode,
    cashAccountCode: s.cashAccountCode,
    bankAccountCode: s.bankAccountCode,
    updatedByLabel: s.updatedByLabel,
    updatedAt: s.updatedAt,
  };
}

const CODE = /^[A-Za-z0-9._-]{1,20}$/;

export async function updateFinanceSettings(db: PrismaClient, actor: StaffActor, input: FinanceSettingsInput, ip?: string | null) {
  assertStaffCan(actor, "manageFinance");
  const fieldErrors: Record<string, string> = {};
  const whole = (key: keyof FinanceSettingsInput, min: number, max: number) => {
    const t = String(input[key]).trim();
    const n = Number(t);
    if (!t || !Number.isInteger(n) || n < min || n > max) fieldErrors[key] = `Enter a whole number from ${min} to ${max}.`;
    return n;
  };
  const code = (key: keyof FinanceSettingsInput) => {
    const t = String(input[key]).trim();
    if (!CODE.test(t)) fieldErrors[key] = "Enter a code of up to 20 letters, digits, dots, dashes or underscores.";
    return t;
  };
  const data = {
    remindersOn: input.remindersOn,
    firstReminderDays: whole("firstReminderDays", 0, 90),
    reminderEveryDays: whole("reminderEveryDays", 1, 90),
    maxReminders: whole("maxReminders", 1, 10),
    salesAccountCode: code("salesAccountCode"),
    taxCode: code("taxCode"),
    zeroTaxCode: code("zeroTaxCode"),
    cashAccountCode: code("cashAccountCode"),
    bankAccountCode: code("bankAccountCode"),
  };
  if (Object.keys(fieldErrors).length) throw new DomainError("invalid", "Check the highlighted fields.", undefined, fieldErrors);
  await db.$transaction(async (tx) => {
    await tx.financeSettings.upsert({
      where: { id: "global" },
      create: { id: "global", ...data, updatedByLabel: actor.name },
      update: { ...data, updatedByLabel: actor.name },
    });
    await audit(
      tx,
      staffAudit(actor, {
        action: "finance.settings",
        summary: `Changed the finance settings: reminders ${data.remindersOn ? `on, ${data.firstReminderDays} days after the due date, every ${data.reminderEveryDays} days, at most ${data.maxReminders}` : "off"}; sales account ${data.salesAccountCode}`,
        ipAddress: ip,
        data,
      }),
    );
  });
}

/** A business customer's account code in the accounting package. Empty means one made from their name. */
export async function setAccountCode(db: PrismaClient, actor: StaffActor, organisationId: string, input: string, ip?: string | null) {
  assertStaffCan(actor, "manageFinance");
  const t = input.trim().toUpperCase();
  if (t && !CODE.test(t)) throw new DomainError("invalid", "Enter a code of up to 20 letters, digits, dots, dashes or underscores, or leave it empty.", "accountCode");
  await db.$transaction(async (tx) => {
    const org = await tx.organisation.findUnique({
      where: { id: organisationId },
      select: { id: true, name: true, accountCode: true },
    });
    if (!org) throw new DomainError("not-found", "No such customer.");
    if (org.accountCode === t) return;
    if (
      t &&
      (await tx.organisation.findFirst({
        where: { accountCode: t, id: { not: org.id } },
        select: { name: true },
      }))
    )
      throw new DomainError("conflict", "Another customer has that account code.", "accountCode");
    await tx.organisation.update({
      where: { id: org.id },
      data: { accountCode: t },
    });
    // Bookkeeping only, so kept off the customer's own history.
    await audit(
      tx,
      staffAudit(actor, {
        action: "organisation.account-code",
        summary: t ? `Set the account code of ${org.name} to ${t}` : `Cleared the account code of ${org.name}`,
        targetType: "Organisation",
        targetId: org.id,
        ipAddress: ip,
      }),
    );
  });
}
