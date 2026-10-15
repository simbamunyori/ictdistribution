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
  const replacements: Record<string, string> = {};
  for (const [k, val] of form.entries()) if (k.startsWith("replace-") && typeof val === "string") replacements[k.slice(8)] = val;
  const values = { note: field(form, "note"), carrier: field(form, "carrier"), reference: field(form, "reference"), supplierReference: field(form, "supplierReference"), ...Object.fromEntries(Object.entries(replacements).map(([k, val]) => [`replace-${k}`, val])) };
  const result = await run(async () => {
    await advanceReturn(prisma, actor, { key: appKey() }, id, step, { note: values.note, carrier: values.carrier, reference: values.reference, supplierReference: values.supplierReference, replacements }, ip);
    return { approve: "Approved. The customer has been emailed.", decline: "Declined. The customer has been emailed.", receive: "Marked received. The customer has been emailed.", repair: "Marked as in repair. The customer has been emailed.", repaired: "Sent back. The customer has been emailed.", replace: "Replacement sent. The customer has been emailed.", credit: "Credit note issued and emailed to the customer.", close: "Settled. The customer has been emailed." }[step];
  }, values);
  if (result.ok) await runSoon("email-deliver").catch(() => undefined);
  revalidatePath(`/admin/returns/${id}`);
  revalidatePath("/admin", "layout");
  return result;
}
