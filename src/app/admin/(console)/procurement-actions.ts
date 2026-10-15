"use server";

import { revalidatePath } from "next/cache";
import { field, run, type ActionState } from "@/server/action-state";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { runSoon } from "@/server/jobs/boss";
import { approvePurchaseOrder, cancelPurchaseOrder, markPoReceived, markPoSentByHand, updateProcurementRules } from "@/server/procurement/purchase-orders";
import { addPoDocument, confirmFromForm, confirmPurchaseOrder, shipFromForm, shipPurchaseOrder } from "@/server/procurement/supplier";
import { appKey } from "@/server/secrets";
import { staff } from "./staff-actor";

/**
 * Admin actions for purchase orders: approving, sending by hand,
 * cancelling, receiving, typing in what a supplier told us, and the
 * rules. Each checks the session again; the service checks the role and
 * writes the audit row.
 */

const deps = () => ({ key: appKey(), replyTo: env().QUOTES_EMAIL });
const done = (poId: string) => {
  revalidatePath(`/admin/purchase-orders/${poId}`);
  revalidatePath("/admin/purchase-orders");
  revalidatePath("/admin", "layout");
};
const deliver = () => runSoon("email-deliver").catch(() => undefined);
const formValues = (form: FormData) => Object.fromEntries([...form.entries()].filter(([k, v]) => typeof v === "string" && !k.startsWith("$") && k !== "line").map(([k, v]) => [k, String(v)]));

export async function approvePoAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const id = field(form, "poId");
  const result = await run(async () => ((await approvePurchaseOrder(prisma, actor, deps(), id, ip)) === "SENT" ? "Approved and emailed to the supplier." : "Approved. Send it on WhatsApp, then mark it sent."));
  if (result.ok) await deliver();
  done(id);
  return result;
}

export async function sentByHandPoAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const id = field(form, "poId");
  const result = await run(() => markPoSentByHand(prisma, actor, deps(), id, ip).then(() => "Marked as sent."));
  done(id);
  return result;
}

export async function cancelPoAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const id = field(form, "poId");
  const values = { reason: field(form, "reason") };
  const result = await run(() => cancelPurchaseOrder(prisma, actor, deps(), id, values.reason, ip).then(() => "Cancelled."), values);
  if (result.ok) await deliver();
  done(id);
  return result;
}

export async function receivedPoAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const id = field(form, "poId");
  const result = await run(() => markPoReceived(prisma, actor, deps(), id, ip).then(() => "Marked as received."));
  done(id);
  return result;
}

export async function staffConfirmPoAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const id = field(form, "poId");
  const result = await run(() => confirmPurchaseOrder(prisma, deps(), { actor, id, ip }, confirmFromForm(form)).then(() => "Saved the supplier's confirmation."), formValues(form));
  done(id);
  return result;
}

export async function staffShipPoAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const id = field(form, "poId");
  const result = await run(() => shipPurchaseOrder(prisma, deps(), { actor, id, ip }, shipFromForm(form)).then(() => "Saved as shipped."), formValues(form));
  done(id);
  return result;
}

export async function staffPoDocumentAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const id = field(form, "poId");
  const kind = field(form, "kind");
  const result = await run(async () => {
    const f = form.get("file");
    const file = f instanceof File && f.size ? { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) } : null;
    await addPoDocument(prisma, deps(), { actor, id, ip }, kind, file);
    return "File added.";
  }, { kind });
  done(id);
  return result;
}

export async function updateProcurementRulesAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const values = { autoSend: form.get("autoSend") === "on" ? "on" : "", maxAutoValue: field(form, "maxAutoValue"), onlyPreferred: form.get("onlyPreferred") === "on" ? "on" : "", deliverTo: field(form, "deliverTo"), paymentTerms: field(form, "paymentTerms") };
  const result = await run(() => updateProcurementRules(prisma, actor, { ...values, autoSend: values.autoSend === "on", onlyPreferred: values.onlyPreferred === "on" }, ip).then(() => "Saved. New purchase orders follow these rules."), values);
  revalidatePath("/admin/purchase-orders/rules");
  return result;
}
