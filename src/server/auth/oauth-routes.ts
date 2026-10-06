import "server-only";
import type { UserKind } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/server/env";
import { runSoon } from "@/server/jobs/boss";
import { redis } from "@/server/redis";
import { enforce, LIMITS, RateLimitedError } from "@/server/security/rate-limit";
import { saveEmailFlow, saveOAuthFlow, savePending, takeOAuthFlow } from "./flow-cookies";
import { linkIdentity, pendingFrom, signInWithProfile } from "./identities";
import { authDeps, currentSession, requestContext, safeNext, setSessionCookie } from "./next";
import { authorizeUrl, exchangeCode, newFlowSecrets, OAuthError, providerFromSlug, providerSlug, verifyIdToken, type OAuthIntent } from "./oauth";
import { AuthError, requestEmailCode, stepUpFresh } from "./service";
import { callbackUrl, providerSettings } from "./sign-in-options";

/**
 * The two ends of a Microsoft or Google sign-in: /auth/{provider}/start
 * sends the person to the provider, and /auth/{provider}/callback takes
 * them back. Staff use the same under /admin. Links, not forms, start it,
 * since the content security policy only lets forms post to this site.
 */

const SIGN_IN: Record<UserKind, string> = { CUSTOMER: "/sign-in", STAFF: "/admin/sign-in" };
const HOME: Record<UserKind, string> = { CUSTOMER: "/account", STAFF: "/admin" };

const to = (path: string) => NextResponse.redirect(new URL(path, env().APP_URL), 303);

/**
 * After a staff sign-in step. Their session cookie is SameSite=Strict, and
 * a redirect chain that began at Microsoft counts as cross-site, so the
 * next page wouldn't see it. A page on our own site moving on by itself
 * makes that next request same-site.
 */
function onward(path: string, audience: UserKind): NextResponse {
  if (audience !== "STAFF") return to(path);
  const url = new URL(path, env().APP_URL).toString().replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return new NextResponse(`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${url}"><title>Signing in</title><a href="${url}">Continue</a>`, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function startOAuth(req: NextRequest, slug: string, audience: UserKind): Promise<NextResponse> {
  const provider = providerFromSlug(slug);
  const settings = provider && providerSettings(provider, audience);
  if (!provider || !settings) return to(SIGN_IN[audience]);
  const intent: OAuthIntent = audience === "CUSTOMER" && req.nextUrl.searchParams.get("intent") === "link" ? "link" : "sign-in";
  let loginHint: string | undefined;
  if (intent === "link") {
    const session = await currentSession("CUSTOMER");
    if (session?.stage !== "ACTIVE") return to(`${SIGN_IN.CUSTOMER}?next=/account/sign-in-methods`);
    if (!stepUpFresh(session)) return to(`/account/confirm?next=${encodeURIComponent("/account/sign-in-methods")}`);
    loginHint = session.user.email;
  }
  const secrets = newFlowSecrets();
  await saveOAuthFlow({ ...secrets, provider, audience, intent, next: safeNext(req.nextUrl.searchParams.get("next"), HOME[audience]), expires: Date.now() + 10 * 60_000 });
  return NextResponse.redirect(authorizeUrl(settings, secrets, callbackUrl(provider, audience), { loginHint }), 303);
}

export async function finishOAuth(req: NextRequest, slug: string, audience: UserKind): Promise<NextResponse> {
  const provider = providerFromSlug(slug);
  const settings = provider && providerSettings(provider, audience);
  const flow = await takeOAuthFlow();
  const q = req.nextUrl.searchParams;
  const p = `p=${slug === "google" ? "google" : "microsoft"}`;
  if (!provider || !settings || !flow || flow.provider !== provider || flow.audience !== audience || flow.expires < Date.now() || q.get("state") !== flow.state) {
    return to(`${SIGN_IN[audience]}?oauth=expired&${p}`);
  }
  const back = flow.intent === "link" ? "/account/sign-in-methods?link-error=" : `${SIGN_IN[audience]}?${p}&oauth=`;
  if (q.get("error") || !q.get("code")) return to(`${back}${q.get("error") === "access_denied" ? "cancelled" : "failed"}`);

  const ctx = await requestContext();
  try {
    await enforce(redis(), `signin:${ctx.ipAddress ?? "unknown"}`, LIMITS.signInPerIp);
    const idToken = await exchangeCode(settings, q.get("code")!, flow.verifier, callbackUrl(provider, audience));
    const profile = await verifyIdToken(settings, idToken, flow.nonce);
    const deps = authDeps();

    if (flow.intent === "link") {
      const session = await currentSession("CUSTOMER");
      if (session?.stage !== "ACTIVE") return to(`${SIGN_IN.CUSTOMER}?next=/account/sign-in-methods`);
      if (!profile.email || !profile.emailVerified || profile.email.toLowerCase() !== session.user.email) return to(`${back}email&${p}`);
      await linkIdentity(deps, session, pendingFrom(profile), ctx);
      await runSoon("email-deliver").catch(() => undefined);
      return to(`/account/sign-in-methods?linked=${providerSlug(provider)}`);
    }

    const outcome = await signInWithProfile(deps, profile, audience, ctx);
    if (outcome.kind === "session") {
      await setSessionCookie(outcome.token, audience);
      if (audience === "STAFF") return onward(outcome.stage === "PASSKEY_SETUP" ? "/admin/setup-passkey" : "/admin/sign-in/passkey", audience);
      return to(flow.next);
    }
    if (outcome.kind === "confirm-link") {
      await enforce(redis(), `code:${outcome.email}`, LIMITS.codePerEmail);
      await requestEmailCode(deps, outcome.email, "CUSTOMER", ctx);
      await runSoon("email-deliver").catch(() => undefined);
      await savePending({ intent: "link", email: outcome.email, name: profile.name, identity: pendingFrom(profile), next: flow.next });
      await saveEmailFlow({ email: outcome.email, next: flow.next });
      return to(`/sign-in/code?link=${providerSlug(provider)}`);
    }
    if (outcome.kind === "sign-up") {
      const toSignUp = flow.next.startsWith("/sign-up") ? flow.next : "/sign-up";
      await savePending({ intent: "sign-up", email: outcome.email, name: outcome.name, identity: pendingFrom(profile), next: toSignUp === "/sign-up" ? flow.next : undefined });
      return to(toSignUp);
    }
    return to(`${back}${outcome.reason}`);
  } catch (e) {
    if (e instanceof OAuthError) return to(`${back}failed`);
    if (e instanceof RateLimitedError) return to(`${back}busy`);
    if (e instanceof AuthError) {
      if (e.code === "step-up") return to(`/account/confirm?next=${encodeURIComponent("/account/sign-in-methods")}`);
      return to(`${back}${flow.intent === "link" ? "taken" : "failed"}`);
    }
    throw e;
  }
}
