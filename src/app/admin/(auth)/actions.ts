"use server";

import { redirect } from "next/navigation";
import { field, run, type ActionState } from "@/server/action-state";
import { clearEmailFlow, readEmailFlow, saveEmailFlow } from "@/server/auth/flow-cookies";
import { authDeps, clearSessionCookie, readSessionToken, requestContext, setSessionCookie, staffHomeFor } from "@/server/auth/next";
import { normaliseEmail, requestEmailCode, signInWithEmailCode, signOut } from "@/server/auth/service";
import { runSoon } from "@/server/jobs/boss";
import { redis } from "@/server/redis";
import { enforce, LIMITS } from "@/server/security/rate-limit";
import { acceptStaffInvitation } from "@/server/staff/staff";

/**
 * Staff sign-in, step one: an emailed code (or Microsoft, from the
 * buttons). Step two is always their passkey. A code is sent only to an
 * active staff address, but the page reads the same either way.
 */

async function sendCode(emailInput: string) {
  const ctx = await requestContext();
  const email = normaliseEmail(emailInput);
  await enforce(redis(), `signin:${ctx.ipAddress ?? "unknown"}`, LIMITS.signInPerIp);
  await enforce(redis(), `code:${email}`, LIMITS.codePerEmail);
  await requestEmailCode(authDeps(), email, "STAFF", ctx);
  await runSoon("email-deliver").catch((e) => console.error("Sending the staff sign-in code failed:", e));
  return email;
}

export async function staffRequestCodeAction(_: ActionState, form: FormData): Promise<ActionState> {
  const values = { email: field(form, "email") };
  let email = "";
  const result = await run(async () => {
    email = await sendCode(values.email);
  }, values);
  if (!result.ok) return result.error === "Enter a valid email address." ? { fieldErrors: { email: result.error }, values } : result;
  await saveEmailFlow({ email, audience: "STAFF" });
  redirect("/admin/sign-in/code");
}

export async function staffResendCodeAction(_: ActionState): Promise<ActionState> {
  const flow = await readEmailFlow();
  if (flow?.audience !== "STAFF") redirect("/admin/sign-in");
  return run(async () => {
    await sendCode(flow.email);
    return "We sent a new code. Earlier codes no longer work.";
  });
}

export async function staffVerifyCodeAction(_: ActionState, form: FormData): Promise<ActionState> {
  const flow = await readEmailFlow();
  if (flow?.audience !== "STAFF") redirect("/admin/sign-in?expired=1");
  const ctx = await requestContext();
  let to = "";
  const result = await run(async () => {
    await enforce(redis(), `codecheck:${ctx.ipAddress ?? "unknown"}`, LIMITS.codeCheckPerIp);
    const outcome = await signInWithEmailCode(authDeps(), flow.email, field(form, "code"), "STAFF", ctx);
    if (outcome.kind !== "session") return;
    await setSessionCookie(outcome.token, "STAFF");
    to = outcome.stage === "PASSKEY_SETUP" ? "/admin/setup-passkey" : "/admin/sign-in/passkey";
  });
  if (!result.ok) return result;
  await clearEmailFlow();
  redirect(to || "/admin/sign-in");
}

/** Opening a staff invitation: makes the account, then straight on to adding a passkey. */
export async function acceptStaffInvitationAction(form: FormData) {
  const { token } = await acceptStaffInvitation(authDeps(), field(form, "token"), await requestContext());
  await setSessionCookie(token, "STAFF");
  redirect("/admin/setup-passkey");
}

export async function staffSignOutAction() {
  await signOut(authDeps(), await readSessionToken("STAFF"));
  await clearSessionCookie("STAFF");
  redirect(staffHomeFor(null));
}
