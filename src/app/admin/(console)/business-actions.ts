"use server";

import type { CustomerTypeCode } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { field, run, type ActionState } from "@/server/action-state";
import { decideCredit, setCreditTerms } from "@/server/accounts/credit";
import { approveOrganisation, rejectOrganisation } from "@/server/accounts/verification";
import { prisma } from "@/server/db";
import { DomainError } from "@/server/errors";
import { runSoon } from "@/server/jobs/boss";
import { removeCustomerPrice, setCustomerPrice } from "@/server/pricing/customer-prices";
import { addVolumeBreak, removeCategoryMarkup, removeVolumeBreak, setCategoryMarkup } from "@/server/pricing/levels";
import { appKey } from "@/server/secrets";
import { productByReference } from "@/server/shop/settings";
import { staff } from "./staff-actor";

/**
 * Admin actions for business customers: checking them, agreed prices,
 * credit, and the rules under each price level. Each checks the session
 * again; the service checks the role and writes the audit row.
 */

const on = (form: FormData, key: string) => form.get(key) === "on";
const pick = (form: FormData, keys: string[]) => Object.fromEntries(keys.map((k) => [k, field(form, k)]));
const customerPath = (id: string) => `/admin/customers/${id}`;
const sendEmails = () => runSoon("email-deliver").catch(() => undefined);

// ─── Checking businesses ─────────────────────────────────────────────

export async function approveOrganisationAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const id = field(form, "organisationId");
  const result = await run(async () => {
    await approveOrganisation(prisma, actor, { key: appKey() }, id, ip);
    await sendEmails();
    return "Approved. They see trade prices from now on, and the owners have an email.";
  });
  revalidatePath(customerPath(id));
  revalidatePath("/admin/customers");
  return result;
}

export async function rejectOrganisationAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const id = field(form, "organisationId");
  const values = { note: field(form, "note") };
  const result = await run(async () => {
    await rejectOrganisation(prisma, actor, { key: appKey() }, id, values.note, ip);
    await sendEmails();
    return "Sent back. The owners have an email with your note.";
  }, values);
  revalidatePath(customerPath(id));
  revalidatePath("/admin/customers");
  return result.ok ? { ...result, values: undefined } : result;
}

// ─── Agreed prices ───────────────────────────────────────────────────

const PRICE_FIELDS = ["product", "price", "validUntil", "note"];

export async function customerPriceAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const id = field(form, "organisationId");
  const values = pick(form, PRICE_FIELDS);
  const result = await run(async () => {
    const product = await productByReference(prisma, values.product, "product");
    await setCustomerPrice(prisma, actor, id, { productId: product.id, price: values.price, validUntil: values.validUntil, note: values.note }, ip);
    return `Saved. ${product.name} shows at this price for them.`;
  }, values);
  revalidatePath(customerPath(id));
  return result.ok ? { ...result, values: undefined } : result;
}

export async function removeCustomerPriceAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const result = await run(() => removeCustomerPrice(prisma, actor, field(form, "id"), ip));
  revalidatePath(customerPath(field(form, "organisationId")));
  return result;
}

// ─── Credit ──────────────────────────────────────────────────────────

export async function creditTermsAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const id = field(form, "organisationId");
  const values = pick(form, ["limit", "termsDays"]);
  const result = await run(async () => {
    await setCreditTerms(prisma, actor, id, { limit: values.limit, termsDays: values.termsDays, onHold: on(form, "onHold") }, ip);
    return values.limit.trim() ? "Saved." : "Credit account closed.";
  }, values);
  revalidatePath(customerPath(id));
  return result;
}

export async function creditDecisionAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const id = field(form, "applicationId");
  const values = pick(form, ["limit", "termsDays", "note"]);
  const approve = field(form, "decision") === "approve";
  const result = await run(async () => {
    if (!["approve", "decline"].includes(field(form, "decision"))) throw new DomainError("invalid", "Choose approve or decline.");
    await decideCredit(prisma, actor, { key: appKey() }, id, { approve, limit: values.limit, termsDays: values.termsDays, note: values.note }, ip);
    await sendEmails();
    return approve ? "Approved. They can buy on account now." : "Declined. They have an email with your note.";
  }, values);
  revalidatePath("/admin/credit");
  revalidatePath(customerPath(field(form, "organisationId")));
  return result;
}

// ─── Price level rules ───────────────────────────────────────────────

const typeOf = (form: FormData) => field(form, "type") as CustomerTypeCode;

export async function categoryMarkupAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const values = pick(form, ["categoryId", "markupPercent"]);
  const result = await run(async () => {
    await setCategoryMarkup(prisma, actor, typeOf(form), values.categoryId, values.markupPercent, ip);
    return "Saved. New prices use it straight away.";
  }, values);
  revalidatePath("/admin/customer-types");
  return result.ok ? { ...result, values: undefined } : result;
}

export async function removeCategoryMarkupAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const result = await run(() => removeCategoryMarkup(prisma, actor, field(form, "id"), ip));
  revalidatePath("/admin/customer-types");
  return result;
}

export async function volumeBreakAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const values = pick(form, ["minQuantity", "discountPercent", "categoryId"]);
  const result = await run(async () => {
    await addVolumeBreak(prisma, actor, typeOf(form), { minQuantity: values.minQuantity, discountPercent: values.discountPercent, categoryId: values.categoryId }, ip);
    return "Added.";
  }, values);
  revalidatePath("/admin/customer-types");
  return result.ok ? { ...result, values: undefined } : result;
}

export async function removeVolumeBreakAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const result = await run(() => removeVolumeBreak(prisma, actor, field(form, "id"), ip));
  revalidatePath("/admin/customer-types");
  return result;
}
