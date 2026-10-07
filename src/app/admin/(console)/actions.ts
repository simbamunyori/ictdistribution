"use server";

import type { CustomerTypeCode, StaffRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { field, run, type ActionState } from "@/server/action-state";
import { setOrganisationType } from "@/server/accounts/organisations";
import { authDeps, requestContext, requireRecentCheck, requireStaff, safeNext } from "@/server/auth/next";
import { removePasskey, renamePasskey } from "@/server/auth/passkeys";
import { requestEmailCode, stepUpWithEmailCode } from "@/server/auth/service";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { DomainError } from "@/server/errors";
import { runSoon } from "@/server/jobs/boss";
import { addCurrency, createMarket, setCurrencyEnabled, updateMarket, type MarketInput } from "@/server/markets/markets";
import { updateCustomerType } from "@/server/pricing/customer-types";
import { acceptRate, OpenErApiSource, refreshRates, setRate, updateRateRules } from "@/server/pricing/rates";
import { redis } from "@/server/redis";
import { enforce, LIMITS } from "@/server/security/rate-limit";
import { assertStaffCan } from "@/server/staff/access";
import { changeStaffRole, inviteStaff, revokeStaffInvitation, setStaffActive } from "@/server/staff/staff";
import { staff } from "./staff-actor";

/**
 * Every admin change goes through here. Each action checks the session
 * again, the service checks the role, and the service writes the audit row.
 */

const on = (form: FormData, key: string) => form.get(key) === "on";
const pick = (form: FormData, keys: string[]) => Object.fromEntries(keys.map((k) => [k, field(form, k)]));

// ─── Customers ───────────────────────────────────────────────────────

export async function organisationTypeAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const result = await run(async () => {
    await setOrganisationType(prisma, actor, field(form, "organisationId"), field(form, "type") as CustomerTypeCode, ip);
    return "Changed. The customer can see this in their history.";
  });
  revalidatePath("/admin/customers");
  return result;
}

export async function customerTypeAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const values = pick(form, ["code", "name", "description", "markupPercent"]);
  const result = await run(async () => {
    await updateCustomerType(prisma, actor, values.code as CustomerTypeCode, { name: values.name, description: values.description, markupPercent: values.markupPercent.trim() === "" ? NaN : Number(values.markupPercent), guestCheckout: on(form, "guestCheckout") }, ip);
    return "Saved. New prices use it straight away.";
  }, values);
  revalidatePath("/admin/customer-types");
  return result;
}

// ─── Markets and currencies ──────────────────────────────────────────

const MARKET_FIELDS = ["country", "name", "currency", "locale", "timeZone", "fxBufferPercent", "roundToMinor", "supportEmail", "sortOrder"];

function marketInput(form: FormData): MarketInput {
  const v = pick(form, MARKET_FIELDS);
  return { ...v, fxBufferPercent: v.fxBufferPercent, roundToMinor: v.roundToMinor, sortOrder: v.sortOrder, enabled: on(form, "enabled"), isDefault: on(form, "isDefault") } as unknown as MarketInput;
}

export async function marketAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const code = field(form, "code");
  const values = pick(form, MARKET_FIELDS);
  let created = "";
  const result = await run(async () => {
    if (code) {
      await updateMarket(prisma, actor, code, marketInput(form), ip);
      return "Saved.";
    }
    created = (await createMarket(prisma, actor, values.country, marketInput(form), ip)).code;
  }, values);
  revalidatePath("/admin/markets");
  if (result.ok && created) redirect(`/admin/markets/${created}?created=1`);
  return result;
}

export async function addCurrencyAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const values = pick(form, ["code", "name"]);
  const result = await run(async () => {
    await addCurrency(prisma, actor, values.code, values.name, ip);
    return `Added ${values.code.trim().toUpperCase()}. The next rate fetch includes it.`;
  }, values);
  revalidatePath("/admin/markets");
  return result.ok ? { ...result, values: undefined } : result;
}

export async function currencyEnabledAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const result = await run(() => setCurrencyEnabled(prisma, actor, field(form, "code"), field(form, "enabled") === "yes", ip));
  revalidatePath("/admin/markets");
  return result;
}

// ─── Exchange rates ──────────────────────────────────────────────────

export async function acceptRateAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const result = await run(() => acceptRate(prisma, actor, field(form, "id"), ip));
  revalidatePath("/admin", "layout");
  return result;
}

export async function setRateAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const values = pick(form, ["quote", "rate"]);
  const result = await run(async () => {
    await setRate(prisma, actor, values.quote, values.rate, ip);
    return "Saved. Prices use it straight away.";
  }, values);
  revalidatePath("/admin", "layout");
  return result.ok ? { ...result, values: undefined } : result;
}

export async function rateRulesAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const values = pick(form, ["holdPercent", "maxAgeHours"]);
  const result = await run(async () => {
    await updateRateRules(prisma, actor, { holdPercent: Number(values.holdPercent || NaN), maxAgeHours: Number(values.maxAgeHours || NaN) }, ip);
    return "Saved.";
  }, values);
  revalidatePath("/admin", "layout");
  return result;
}

export async function fetchRatesAction(_: ActionState): Promise<ActionState> {
  const { actor } = await staff();
  const result = await run(async () => {
    assertStaffCan(actor, "manageRates");
    if (env().RATE_SOURCE === "off") throw new DomainError("invalid", "Fetching is switched off on this server (RATE_SOURCE=off). Set a rate by hand below.");
    try {
      const r = await refreshRates(prisma, new OpenErApiSource());
      const parts = [r.stored.length ? `updated ${r.stored.join(", ")}` : "", r.held.length ? `held back ${r.held.join(", ")}` : "", r.unchanged.length ? `no change for ${r.unchanged.join(", ")}` : ""].filter(Boolean);
      return `Fetched: ${parts.join("; ") || "nothing to update"}.`;
    } catch (e) {
      throw new DomainError("invalid", `The fetch failed: ${e instanceof Error ? e.message : "unknown error"} The rates in use stay as they were.`);
    }
  });
  revalidatePath("/admin", "layout");
  return result;
}

// ─── Staff ───────────────────────────────────────────────────────────

export async function inviteStaffAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const values = pick(form, ["name", "email", "role"]);
  const result = await run(async () => {
    await inviteStaff(authDeps(), actor, { name: values.name, email: values.email, role: values.role as StaffRole }, { ipAddress: ip });
    await runSoon("email-deliver").catch(() => undefined);
    return `Invitation sent to ${values.email.trim().toLowerCase()}. The link works for 3 days.`;
  }, values);
  revalidatePath("/admin/staff");
  return result.ok ? { ...result, values: undefined } : result;
}

export async function staffMemberAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { actor, ip } = await staff();
  const op = field(form, "op");
  const userId = field(form, "userId");
  const result = await run(async () => {
    if (op === "role") await changeStaffRole(prisma, actor, userId, field(form, "role") as StaffRole, ip);
    else if (op === "off") await setStaffActive(prisma, actor, userId, false, ip);
    else if (op === "on") await setStaffActive(prisma, actor, userId, true, ip);
    else if (op === "withdraw") await revokeStaffInvitation(prisma, actor, field(form, "invitationId"), ip);
  });
  revalidatePath("/admin/staff");
  return result;
}

// ─── Your staff account ──────────────────────────────────────────────

export async function staffRemovePasskeyAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireStaff();
  await requireRecentCheck(session, "/admin/account");
  const ctx = await requestContext();
  const result = await run(() => removePasskey(authDeps(), session, field(form, "passkeyId"), ctx));
  revalidatePath("/admin/account");
  return result;
}

export async function staffRenamePasskeyAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireStaff();
  const result = await run(async () => {
    await renamePasskey(authDeps(), session, field(form, "passkeyId"), field(form, "name"));
    return "Renamed.";
  });
  revalidatePath("/admin/account");
  return result;
}

export async function staffSendConfirmCodeAction(_: ActionState): Promise<ActionState> {
  const session = await requireStaff();
  return run(async () => {
    await enforce(redis(), `code:${session.user.email}`, LIMITS.codePerEmail);
    await requestEmailCode(authDeps(), session.user.email, "STAFF", await requestContext());
    await runSoon("email-deliver").catch(() => undefined);
    return `We sent a code to ${session.user.email}.`;
  });
}

export async function staffConfirmCodeAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireStaff();
  const ctx = await requestContext();
  const result = await run(async () => {
    await enforce(redis(), `codecheck:${ctx.ipAddress ?? "unknown"}`, LIMITS.codeCheckPerIp);
    await stepUpWithEmailCode(authDeps(), session, field(form, "code"));
  });
  if (!result.ok) return result;
  redirect(safeNext(field(form, "next"), "/admin/account"));
}
