"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { field, run, type ActionState } from "@/server/action-state";
import { applyForCredit } from "@/server/accounts/credit";
import { actorFor } from "@/server/accounts/organisations";
import { addDocument, removeDocument, saveBusinessDetails, submitForCheck } from "@/server/accounts/verification";
import { requestContext, requireCustomer } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { DomainError } from "@/server/errors";
import { redis } from "@/server/redis";
import { enforce, LIMITS } from "@/server/security/rate-limit";

/** Business checks and credit, for the organisation the customer acts for. */

async function member(path: string) {
  const session = await requireCustomer(path);
  const actor = await actorFor(prisma, session);
  if (!actor) redirect("/account");
  return { actor, ip: (await requestContext()).ipAddress };
}

const DETAIL_FIELDS = ["name", "registrationNumber", "taxNumber", "address", "directors"] as const;

export async function businessDetailsAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await member("/account/business");
  const values = Object.fromEntries(DETAIL_FIELDS.map((k) => [k, field(form, k)])) as Record<(typeof DETAIL_FIELDS)[number], string>;
  const result = await run(async () => {
    await saveBusinessDetails(prisma, actor, values, ip);
    return "Saved.";
  }, values);
  revalidatePath("/account/business");
  return result;
}

export async function addDocumentAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await member("/account/business");
  const values = { kind: field(form, "kind") };
  const result = await run(async () => {
    const f = form.get("file");
    if (!(f instanceof File) || !f.size) throw new DomainError("invalid", "Choose a file.", "file");
    await enforce(redis(), `documents:${actor.organisationId}`, LIMITS.documentsPerOrg);
    await addDocument(prisma, actor, values.kind, { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }, ip);
    return "Added.";
  }, values);
  revalidatePath("/account/business");
  return result.ok ? { ...result, values: undefined } : result;
}

export async function removeDocumentAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await member("/account/business");
  const result = await run(() => removeDocument(prisma, actor, field(form, "documentId"), ip));
  revalidatePath("/account/business");
  return result;
}

export async function submitForCheckAction(_: ActionState): Promise<ActionState> {
  const { actor, ip } = await member("/account/business");
  const result = await run(async () => {
    await submitForCheck(prisma, actor, {}, ip);
    return "Sent. We will email you once we have checked it.";
  });
  revalidatePath("/account/business");
  return result;
}

export async function applyForCreditAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await member("/account/credit");
  const values = { limit: field(form, "limit"), termsDays: field(form, "termsDays"), details: field(form, "details") };
  const result = await run(async () => {
    await applyForCredit(prisma, actor, values, ip);
    return "Sent to our Finance team. We will email you with their decision.";
  }, values);
  revalidatePath("/account/credit");
  return result.ok ? { ...result, values: undefined } : result;
}
