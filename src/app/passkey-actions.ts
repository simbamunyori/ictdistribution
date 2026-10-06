"use server";

import type { UserKind } from "@prisma/client";
import type { AuthenticationResponseJSON, PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { saveChallenge, takeChallenge, type ChallengePurpose } from "@/server/auth/flow-cookies";
import { authDeps, currentSession, readSessionToken, requestContext, safeNext, setSessionCookie } from "@/server/auth/next";
import { addPasskey, authenticationOptions, authenticationOptionsFor, completeWithPasskey, registrationOptions, setupFirstPasskey, signInWithPasskey, stepUpWithPasskey } from "@/server/auth/passkeys";
import { AuthError, getSession, stepUpFresh } from "@/server/auth/service";
import { siteRelyingParty } from "@/server/auth/sign-in-options";
import { runSoon } from "@/server/jobs/boss";
import { redis } from "@/server/redis";
import { enforce, LIMITS, RateLimitedError } from "@/server/security/rate-limit";

/**
 * The server half of every passkey use (src/components/auth/passkey-button.tsx).
 * Each use asks for options (a fresh challenge, kept in a sealed cookie),
 * then hands back what the device signed.
 */

export type PasskeyOptions =
  | { kind: "register"; options: PublicKeyCredentialCreationOptionsJSON }
  | { kind: "authenticate"; options: PublicKeyCredentialRequestOptionsJSON }
  | { error: string; redirect?: string };

export interface PasskeyResult {
  redirect?: string;
  error?: string;
  added?: boolean;
}

const HOME: Record<UserKind, string> = { CUSTOMER: "/account", STAFF: "/admin" };

async function sessionFor(audience: UserKind) {
  const token = await readSessionToken(audience);
  return { token, session: token ? await getSession(authDeps(), token, audience) : null };
}

export async function passkeyOptionsAction(purpose: ChallengePurpose, audience: UserKind): Promise<PasskeyOptions> {
  const rp = siteRelyingParty();
  const deps = authDeps();
  try {
    if (purpose === "sign-in") {
      const ctx = await requestContext();
      await enforce(redis(), `signin:${ctx.ipAddress ?? "unknown"}`, LIMITS.signInPerIp);
      const options = await authenticationOptions(rp);
      await saveChallenge({ challenge: options.challenge, purpose });
      return { kind: "authenticate", options };
    }
    const { session } = await sessionFor(audience);
    if (!session) return { error: "Your sign-in timed out.", redirect: audience === "STAFF" ? "/admin/sign-in" : "/sign-in" };
    if (purpose === "second-step" || purpose === "step-up") {
      if (purpose === "second-step" && session.stage !== "PASSKEY_PENDING") return { error: "Start signing in again.", redirect: "/admin/sign-in" };
      const options = await authenticationOptionsFor(deps, rp, session.userId);
      await saveChallenge({ challenge: options.challenge, purpose, userId: session.userId });
      return { kind: "authenticate", options };
    }
    if (purpose === "setup" && session.stage !== "PASSKEY_SETUP") return { error: "Start signing in again.", redirect: "/admin/sign-in" };
    if (purpose === "add" && (session.stage !== "ACTIVE" || !stepUpFresh(session))) return { error: "Confirm it's you first.", redirect: `${HOME[audience]}/confirm?next=${HOME[audience]}${audience === "STAFF" ? "/account" : "/sign-in-methods"}` };
    const options = await registrationOptions(deps, rp, session.user);
    await saveChallenge({ challenge: options.challenge, purpose, userId: session.userId });
    return { kind: "register", options };
  } catch (e) {
    if (e instanceof AuthError) return { error: e.message };
    if (e instanceof RateLimitedError) return { error: "Too many tries. Wait a few minutes and try again." };
    throw e;
  }
}

export async function passkeyVerifyAction(purpose: ChallengePurpose, audience: UserKind, response: AuthenticationResponseJSON | RegistrationResponseJSON, next?: string): Promise<PasskeyResult> {
  const rp = siteRelyingParty();
  const deps = authDeps();
  const ctx = await requestContext();
  try {
    if (purpose === "sign-in") {
      const challenge = await takeChallenge("sign-in");
      if (!challenge) return { error: "That took too long. Try again." };
      const { token } = await signInWithPasskey(deps, rp, response as AuthenticationResponseJSON, challenge, audience, ctx);
      await setSessionCookie(token, audience);
      return { redirect: safeNext(next, HOME[audience]) };
    }
    const { token, session } = await sessionFor(audience);
    if (!session) return { redirect: audience === "STAFF" ? "/admin/sign-in" : "/sign-in" };
    const challenge = await takeChallenge(purpose, session.userId);
    if (!challenge) return { error: "That took too long. Try again." };
    if (purpose === "second-step") {
      const done = await completeWithPasskey(deps, rp, token, response as AuthenticationResponseJSON, challenge, ctx);
      await setSessionCookie(done.token, audience);
      return { redirect: safeNext(next, HOME[audience]) };
    }
    if (purpose === "setup") {
      const done = await setupFirstPasskey(deps, rp, token, response as RegistrationResponseJSON, challenge, ctx);
      await setSessionCookie(done.token, audience);
      await runSoon("email-deliver").catch(() => undefined);
      return { redirect: HOME[audience] };
    }
    if (purpose === "step-up") {
      await stepUpWithPasskey(deps, rp, session, response as AuthenticationResponseJSON, challenge);
      return { redirect: safeNext(next, HOME[audience]) };
    }
    const current = await currentSession(audience);
    if (!current) return { redirect: audience === "STAFF" ? "/admin/sign-in" : "/sign-in" };
    await addPasskey(deps, rp, current, response as RegistrationResponseJSON, challenge, ctx);
    await runSoon("email-deliver").catch(() => undefined);
    return { added: true };
  } catch (e) {
    if (e instanceof AuthError) return { error: e.message };
    throw e;
  }
}
