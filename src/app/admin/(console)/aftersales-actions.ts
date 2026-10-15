"use server";

import { revalidatePath } from "next/cache";
import { field, run, type ActionState } from "@/server/action-state";
import { recordRefund } from "@/server/aftersales/credit-notes";
import { setLineSerials } from "@/server/aftersales/units";
import { prisma } from "@/server/db";
import { runSoon } from "@/server/jobs/boss";
import { appKey } from "@/server/secrets";
import { staff } from "./staff-actor";

/** Serial numbers typed for one order line. The service checks the role, starts warranties and writes the audit row. */
export async function setSerialsAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const values = { serials: field(form, "serials") };
  const result = await run(async () => {
    await setLineSerials(prisma, actor, field(form, "lineId"), values.serials, ip);
    return "Saved.";
  }, values);
  revalidatePath(`/admin/orders/${field(form, "orderId")}`);
  return result;
}

/** Money paid back to a customer who paid more than is now owed. */
export async function recordRefundAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const id = field(form, "orderId");
  const values = { amount: field(form, "amount"), reference: field(form, "reference"), paidOn: field(form, "paidOn") };
  const result = await run(async () => {
    await recordRefund(prisma, actor, { key: appKey() }, id, values, ip);
    return "Recorded. The customer has been emailed.";
  }, values);
  if (result.ok) await runSoon("email-deliver").catch(() => undefined);
  revalidatePath(`/admin/orders/${id}`);
  return result;
}
