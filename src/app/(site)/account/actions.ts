"use server";

import type { CustomerTypeCode, IdentityProvider, OrgRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { field, run, type ActionState } from "@/server/action-state";
import { acceptInvitation, actorFor, changeRole, createOrganisation, inviteMember, removeMember, revokeInvitation, switchOrganisation } from "@/server/accounts/organisations";
import { unlinkIdentity } from "@/server/auth/identities";
import { authDeps, requestContext, requireCustomer, requireRecentCheck, safeNext } from "@/server/auth/next";
import { removePasskey } from "@/server/auth/passkeys";
import { requestEmailCode, stepUpWithEmailCode, updateProfile } from "@/server/auth/service";
import { DomainError } from "@/server/errors";
import { runSoon } from "@/server/jobs/boss";
import { ORG_ROLES } from "@/server/org/access";
import { redis } from "@/server/redis";
import { enforce, LIMITS } from "@/server/security/rate-limit";

export async function profileAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireCustomer("/account");
  const values = { name: field(form, "name"), phone: field(form, "phone") };
  const result = await run(async () => {
    await updateProfile(authDeps(), session, values, await requestContext());
    return "Saved.";
  }, values);
  revalidatePath("/account");
  return result;
}

export async function switchAction(form: FormData) {
  const session = await requireCustomer("/account");
  const id = field(form, "organisationId");
  await switchOrganisation(authDeps(), session, id || null);
  redirect(safeNext(field(form, "back"), "/account"));
}

export async function createOrganisationAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireCustomer("/account");
  const values = Object.fromEntries(["organisation", "organisationType", "country", "registrationNumber", "taxNumber"].map((k) => [k, field(form, k)]));
  const result = await run(async () => {
    await createOrganisation(authDeps(), session, { name: values.organisation, type: values.organisationType as CustomerTypeCode, country: values.country, registrationNumber: values.registrationNumber, taxNumber: values.taxNumber }, await requestContext());
  }, values);
  if (!result.ok) return result;
  redirect("/account/team?created=1");
}

async function teamActor() {
  const session = await requireCustomer("/account/team");
  const actor = await actorFor(authDeps().db, session);
  if (!actor) redirect("/account");
  return { session, actor };
}

export async function inviteAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await teamActor();
  const values = { email: field(form, "email"), role: field(form, "role") };
  const result = await run(async () => {
    if (!ORG_ROLES.includes(values.role as OrgRole)) throw new DomainError("invalid", "Choose a role.", "role");
    await enforce(redis(), `invite:${actor.organisationId}`, LIMITS.invitePerOrg);
    await inviteMember(authDeps(), actor, values.email, values.role as OrgRole, await requestContext());
    await runSoon("email-deliver").catch(() => undefined);
    return `Invitation sent to ${values.email.trim().toLowerCase()}.`;
  }, values);
  revalidatePath("/account/team");
  return result.ok ? { ...result, values: undefined } : result;
}

export async function memberAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor } = await teamActor();
  const ctx = await requestContext();
  const result = await run(async () => {
    const op = field(form, "op");
    if (op === "role") await changeRole(authDeps(), actor, field(form, "membershipId"), field(form, "role") as OrgRole, ctx);
    else if (op === "remove") await removeMember(authDeps(), actor, field(form, "membershipId"), ctx);
    else if (op === "revoke") await revokeInvitation(authDeps(), actor, field(form, "invitationId"), ctx);
  });
  revalidatePath("/account/team");
  return result;
}

export async function acceptInvitationAction(form: FormData) {
  const token = field(form, "token");
  const session = await requireCustomer(`/invite/${token}`);
  await acceptInvitation(authDeps(), session, token, await requestContext());
  redirect("/account/team?joined=1");
}

export async function removePasskeyAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireCustomer("/account/sign-in-methods");
  await requireRecentCheck(session, "/account/sign-in-methods");
  const result = await run(() => removePasskey(authDeps(), session, field(form, "passkeyId"), undefined));
  revalidatePath("/account/sign-in-methods");
  return result;
}

export async function unlinkAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireCustomer("/account/sign-in-methods");
  await requireRecentCheck(session, "/account/sign-in-methods");
  const provider = field(form, "provider") as IdentityProvider;
  const result = await run(() => unlinkIdentity(authDeps(), session, provider === "GOOGLE" ? "GOOGLE" : "MICROSOFT", undefined));
  revalidatePath("/account/sign-in-methods");
  return result;
}

/** The recent check by email, for people without a passkey here. */
export async function sendConfirmCodeAction(_: ActionState): Promise<ActionState> {
  const session = await requireCustomer("/account");
  return run(async () => {
    await enforce(redis(), `code:${session.user.email}`, LIMITS.codePerEmail);
    await requestEmailCode(authDeps(), session.user.email, "CUSTOMER", await requestContext());
    await runSoon("email-deliver").catch(() => undefined);
    return `We sent a code to ${session.user.email}.`;
  });
}

export async function confirmCodeAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireCustomer("/account");
  const ctx = await requestContext();
  const result = await run(async () => {
    await enforce(redis(), `codecheck:${ctx.ipAddress ?? "unknown"}`, LIMITS.codeCheckPerIp);
    await stepUpWithEmailCode(authDeps(), session, field(form, "code"));
  });
  if (!result.ok) return result;
  redirect(safeNext(field(form, "next"), "/account"));
}
