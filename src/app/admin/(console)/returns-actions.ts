"use server";

import { revalidatePath } from "next/cache";
import { field, run, type ActionState } from "@/server/action-state";
import { prisma } from "@/server/db";
import { runSoon } from "@/server/jobs/boss";
import { advanceReturn, type ReturnStep } from "@/server/portal/returns";
import { appKey } from "@/server/secrets";
import { staff } from "./staff-actor";

/** Answers a customer's return and moves it on. The service checks the role, emails the customer and writes the audit row. */
export async function advanceReturnAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const id = field(form, "returnId");
  const step = field(form, "step") as ReturnStep;
  const values = { note: field(form, "note") };
  const result = await run(async () => {
    await advanceReturn(prisma, actor, { key: appKey() }, id, step, values.note, ip);
    return { approve: "Approved. The customer has been emailed.", decline: "Declined. The customer has been emailed.", receive: "Marked received. The customer has been emailed.", close: "Settled. The customer has been emailed." }[step];
  }, values);
  if (result.ok) await runSoon("email-deliver").catch(() => undefined);
  revalidatePath(`/admin/returns/${id}`);
  revalidatePath("/admin", "layout");
  return result;
}
