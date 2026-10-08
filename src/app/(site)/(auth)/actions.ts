"use server";

import type { CustomerTypeCode } from "@prisma/client";
import { redirect } from "next/navigation";
import { field, run, type ActionState } from "@/server/action-state";
import { SignUpError, signUp } from "@/server/accounts/sign-up";
import { clearEmailFlow, clearPending, readEmailFlow, readPending, saveEmailFlow, savePending } from "@/server/auth/flow-cookies";
import { confirmLinkWithCode } from "@/server/auth/identities";
import { authDeps, requestContext, safeNext, setSessionCookie } from "@/server/auth/next";
import { normaliseEmail, requestEmailCode, signInWithEmailCode } from "@/server/auth/service";
import { runSoon } from "@/server/jobs/boss";
import { redis } from "@/server/redis";
import { enforce, LIMITS } from "@/server/security/rate-limit";

async function sendCode(emailInput: string) {
  const ctx = await requestContext();
  const email = normaliseEmail(emailInput);
  await enforce(redis(), `signin:${ctx.ipAddress ?? "unknown"}`, LIMITS.signInPerIp);
  await enforce(redis(), `code:${email}`, LIMITS.codePerEmail);
  await requestEmailCode(authDeps(), email, "CUSTOMER", ctx);
  await runSoon("email-deliver").catch((e) => console.error("Sending the sign-in code failed:", e));
  return email;
}

/** Step one for everyone: email a code. Works the same whether or not the address has an account. */
export async function requestCodeAction(_: ActionState, form: FormData): Promise<ActionState> {
  const values = { email: field(form, "email") };
  let email = "";
  const result = await run(async () => {
    email = await sendCode(values.email);
  }, values);
  if (!result.ok) return result.error === "Enter a valid email address." ? { fieldErrors: { email: result.error }, values } : result;
  await saveEmailFlow({ email, next: safeNext(field(form, "next"), "") || undefined });
  redirect("/sign-in/code");
}

export async function resendCodeAction(_: ActionState): Promise<ActionState> {
  const flow = await readEmailFlow();
  if (!flow || flow.audience === "STAFF") redirect("/sign-in");
  return run(async () => {
    await sendCode(flow.email);
    return "We sent a new code. Earlier codes no longer work.";
  });
}

export async function verifyCodeAction(_: ActionState, form: FormData): Promise<ActionState> {
  const flow = await readEmailFlow();
  if (!flow || flow.audience === "STAFF") redirect("/sign-in?expired=1");
  const ctx = await requestContext();
  const deps = authDeps();
  const pending = await readPending();
  let to = "";
  const result = await run(async () => {
    await enforce(redis(), `codecheck:${ctx.ipAddress ?? "unknown"}`, LIMITS.codeCheckPerIp);
    if (pending?.intent === "link" && pending.identity && pending.email === flow.email) {
      const { token } = await confirmLinkWithCode(deps, pending.identity, field(form, "code"), ctx);
      await setSessionCookie(token, "CUSTOMER");
      await clearPending();
      await runSoon("email-deliver").catch(() => undefined);
      to = safeNext(flow.next, "/account");
      return;
    }
    const outcome = await signInWithEmailCode(deps, flow.email, field(form, "code"), "CUSTOMER", ctx);
    if (outcome.kind === "session") {
      await setSessionCookie(outcome.token, "CUSTOMER");
      to = safeNext(flow.next, "/account");
    } else {
      const toSignUp = flow.next?.startsWith("/sign-up") ? flow.next : "/sign-up";
      await savePending({ intent: "sign-up", email: outcome.email, name: null, next: toSignUp === "/sign-up" ? flow.next : undefined });
      to = toSignUp;
    }
  });
  if (!result.ok) return result;
  await clearEmailFlow();
  redirect(to);
}

export async function signUpAction(_: ActionState, form: FormData): Promise<ActionState> {
  const pending = await readPending();
  if (pending?.intent !== "sign-up") redirect("/sign-in?expired=1");
  const values = Object.fromEntries(["name", "country", "accountType", "organisation", "organisationType", "registrationNumber", "taxNumber"].map((k) => [k, field(form, k)]));
  const ctx = await requestContext();
  try {
    await enforce(redis(), `signup:${ctx.ipAddress ?? "unknown"}`, LIMITS.signUpPerIp);
    const business = values.accountType === "business";
    const { token } = await signUp(
      authDeps(),
      {
        email: pending.email,
        name: values.name,
        country: values.country,
        organisation: business ? { name: values.organisation, type: values.organisationType as CustomerTypeCode, registrationNumber: values.registrationNumber, taxNumber: values.taxNumber } : undefined,
        identity: pending.identity,
      },
      ctx,
    );
    await setSessionCookie(token, "CUSTOMER");
  } catch (e) {
    if (e instanceof SignUpError) return { fieldErrors: e.fieldErrors, values };
    const result = await run(() => Promise.reject(e), values);
    return result;
  }
  await clearPending();
  redirect(safeNext(pending.next, "/account?welcome=1"));
}
