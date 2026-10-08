"use server";

import { revalidatePath } from "next/cache";
import { field, run, type ActionState } from "@/server/action-state";
import { prisma } from "@/server/db";
import { sendReminderNow } from "@/server/finance/reminders";
import { setAccountCode, updateFinanceSettings } from "@/server/finance/settings";
import { runSoon } from "@/server/jobs/boss";
import { appKey } from "@/server/secrets";
import { staff } from "./staff-actor";

/** Finance: settings, account codes and chasing overdue invoices. Each service checks the role and writes the audit row. */

const SETTINGS_FIELDS = ["firstReminderDays", "reminderEveryDays", "maxReminders", "salesAccountCode", "taxCode", "zeroTaxCode", "cashAccountCode", "bankAccountCode"] as const;

export async function updateFinanceSettingsAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const values = {
    ...Object.fromEntries(SETTINGS_FIELDS.map((k) => [k, field(form, k)])),
    remindersOn: field(form, "remindersOn"),
  } as Record<string, string>;
  const result = await run(async () => {
    await updateFinanceSettings(
      prisma,
      actor,
      {
        ...(values as unknown as Record<(typeof SETTINGS_FIELDS)[number], string>),
        remindersOn: values.remindersOn === "on",
      },
      ip,
    );
    return "Saved.";
  }, values);
  revalidatePath("/admin/finance/settings");
  return result;
}

export async function setAccountCodeAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const id = field(form, "organisationId");
  const values = { accountCode: field(form, "accountCode") };
  const result = await run(async () => {
    await setAccountCode(prisma, actor, id, values.accountCode, ip);
    return "Saved.";
  }, values);
  revalidatePath(`/admin/customers/${id}`);
  return result;
}

export async function sendReminderAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const result = await run(async () => {
    const number = await sendReminderNow(prisma, actor, { key: appKey() }, field(form, "invoiceId"), ip);
    return `Reminder sent for ${number}.`;
  });
  if (result.ok) await runSoon("email-deliver").catch(() => undefined);
  revalidatePath("/admin/finance");
  return result;
}
