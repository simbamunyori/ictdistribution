"use server";

import { revalidatePath } from "next/cache";
import { field, run, type ActionState } from "@/server/action-state";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { runSoon } from "@/server/jobs/boss";
import { requestPrices, sendQuote } from "@/server/quotes/pricing";
import { addLine, cancelQuote, removeLine, repriceQuote, setIncludeDocuments, updateLine, updateQuoteRules, type LineInput } from "@/server/quotes/staff";
import { answerFromForm, enterSupplierPrices, markSentByHand } from "@/server/quotes/suppliers";
import { appKey } from "@/server/secrets";
import { staff } from "./staff-actor";

/**
 * Admin actions for quotes: checking lines, asking suppliers, entering
 * their prices, sending and the rules. Each checks the session again; the
 * service checks the role and writes the audit row.
 */

const deps = () => ({ key: appKey(), replyTo: env().QUOTES_EMAIL });
const LINE_FIELDS = ["description", "quantity", "reference", "categoryId", "cost", "leadTimeDays", "price"] as const;
const lineInput = (form: FormData) => Object.fromEntries(LINE_FIELDS.map((k) => [k, field(form, k)])) as unknown as LineInput;
const done = (quoteId: string) => {
  revalidatePath(`/admin/quotes/${quoteId}`);
  revalidatePath("/admin/quotes");
};
const deliver = () => runSoon("email-deliver").catch(() => undefined);

export async function updateLineAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const values = lineInput(form);
  const result = await run(() => updateLine(prisma, actor, deps(), field(form, "lineId"), values, ip).then(() => "Saved and priced again."), values as unknown as Record<string, string>);
  done(field(form, "quoteId"));
  return result;
}

export async function addLineAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const values = lineInput(form);
  const result = await run(() => addLine(prisma, actor, deps(), field(form, "quoteId"), values, ip).then(() => "Line added."), values as unknown as Record<string, string>);
  done(field(form, "quoteId"));
  return result;
}

export async function removeLineAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const result = await run(() => removeLine(prisma, actor, deps(), field(form, "lineId"), ip).then(() => "Line removed."));
  done(field(form, "quoteId"));
  return result;
}

export async function includeDocumentsAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const result = await run(() => setIncludeDocuments(prisma, actor, field(form, "quoteId"), field(form, "include") === "yes", ip).then(() => "Saved."));
  done(field(form, "quoteId"));
  return result;
}

export async function repriceQuoteAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await staff();
  const result = await run(() => repriceQuote(prisma, actor, deps(), field(form, "quoteId")).then(() => "Priced again."));
  done(field(form, "quoteId"));
  return result;
}

export async function askSuppliersAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const result = await run(async () => {
    const asked = await requestPrices(prisma, actor, deps(), field(form, "quoteId"), ip);
    return `Asked ${asked} ${asked === 1 ? "supplier" : "suppliers"}.`;
  });
  if (result.ok) await deliver();
  done(field(form, "quoteId"));
  return result;
}

export async function sendQuoteAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const result = await run(() => sendQuote(prisma, actor, deps(), field(form, "quoteId"), ip).then(() => "Sent to the customer."));
  if (result.ok) await deliver();
  done(field(form, "quoteId"));
  return result;
}

export async function cancelQuoteAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const values = { reason: field(form, "reason") };
  const result = await run(() => cancelQuote(prisma, actor, deps(), field(form, "quoteId"), values.reason, ip).then(() => "Cancelled. The customer has been told."), values);
  if (result.ok) await deliver();
  done(field(form, "quoteId"));
  return result;
}

export async function markSentByHandAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const result = await run(() => markSentByHand(prisma, actor, deps(), field(form, "requestId"), ip).then(() => "Marked as sent."));
  done(field(form, "quoteId"));
  return result;
}

export async function enterSupplierPricesAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const values = Object.fromEntries([...form.entries()].filter(([k, v]) => typeof v === "string" && !k.startsWith("$")).map(([k, v]) => [k, String(v)]));
  const result = await run(() => enterSupplierPrices(prisma, actor, deps(), field(form, "requestId"), answerFromForm(form), ip).then(() => "Prices saved."), values);
  if (result.ok) await deliver();
  done(field(form, "quoteId"));
  return result;
}

const RULE_FIELDS = ["maxAutoValue", "minMarginPercent", "minMatchConfidence", "supplierHours", "urgentSupplierHours", "validityDays", "tenderMarkupPercent", "projectMarkupPercent", "tenderReminderHours"] as const;

export async function updateQuoteRulesAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const values = { ...Object.fromEntries(RULE_FIELDS.map((k) => [k, field(form, k)])), automationEnabled: form.get("automationEnabled") === "on" ? "on" : "" } as Record<string, string>;
  const result = await run(() => updateQuoteRules(prisma, actor, { ...(values as Record<(typeof RULE_FIELDS)[number], string>), automationEnabled: values.automationEnabled === "on" }, ip).then(() => "Saved. New quotes follow these rules."), values);
  revalidatePath("/admin/quotes/rules");
  return result;
}
