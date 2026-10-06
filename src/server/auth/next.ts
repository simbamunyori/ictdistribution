import "server-only";
import type { UserKind } from "@prisma/client";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { appKey } from "@/server/secrets";
import { SESSION_COOKIE } from "./cookies";
import { getSession, stepUpFresh, type AuthDeps, type RequestContext, type SessionWithUser } from "./service";

/**
 * Next.js glue for the auth service: the session cookies, request
 * details, and guards for pages. Customers and staff have separate
 * cookies; neither opens the other's pages.
 */

const SECURE = process.env.NODE_ENV === "production";

export function authDeps(): AuthDeps {
  return { db: prisma, key: appKey() };
}

export async function requestContext(): Promise<RequestContext> {
  const h = await headers();
  // Apache (or Caddy) replaces X-Forwarded-For with the connecting address; the first entry is the client.
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return { ipAddress: forwarded || h.get("x-real-ip") || null, userAgent: h.get("user-agent") };
}

export async function readSessionToken(audience: UserKind): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE[audience])?.value;
}

export async function setSessionCookie(token: string, audience: UserKind) {
  (await cookies()).set(SESSION_COOKIE[audience], token, {
    httpOnly: true,
    secure: SECURE,
    // Strict for staff: no link from anywhere else carries the staff session.
    sameSite: audience === "STAFF" ? "strict" : "lax",
    path: "/",
    // The server decides expiry; this only bounds how long the browser keeps it.
    maxAge: audience === "STAFF" ? 24 * 60 * 60 : 30 * 24 * 60 * 60,
  });
}

export async function clearSessionCookie(audience: UserKind) {
  (await cookies()).delete(SESSION_COOKIE[audience]);
}

export async function currentSession(audience: UserKind): Promise<SessionWithUser | null> {
  const token = await readSessionToken(audience);
  if (!token) return null;
  return getSession(authDeps(), token, audience);
}

/** Where a staff session in each stage belongs. */
export function staffHomeFor(session: SessionWithUser | null): string {
  if (!session) return "/admin/sign-in";
  if (session.stage === "PASSKEY_PENDING") return "/admin/sign-in/passkey";
  if (session.stage === "PASSKEY_SETUP") return "/admin/setup-passkey";
  return "/admin";
}

/** For customer pages: signed in, or off to sign in and back. */
export async function requireCustomer(back: string): Promise<SessionWithUser> {
  const session = await currentSession("CUSTOMER");
  if (session?.stage !== "ACTIVE") redirect(`/sign-in?next=${encodeURIComponent(back)}`);
  return session;
}

/** For staff pages. */
export async function requireStaff(): Promise<SessionWithUser & { user: { staffRole: NonNullable<SessionWithUser["user"]["staffRole"]> } }> {
  const session = await currentSession("STAFF");
  if (session?.stage !== "ACTIVE" || !session.user.staffRole) redirect(staffHomeFor(session));
  return session as SessionWithUser & { user: { staffRole: NonNullable<SessionWithUser["user"]["staffRole"]> } };
}

/** Before a sensitive change: a passkey or code in the last 15 minutes, or off to confirm and come back. */
export async function requireRecentCheck(session: SessionWithUser, back: string): Promise<void> {
  if (stepUpFresh(session)) return;
  redirect(`${session.audience === "STAFF" ? "/admin" : "/account"}/confirm?next=${encodeURIComponent(back)}`);
}

/** A path inside this site to go to after signing in, or the fallback. */
export function safeNext(next: string | null | undefined, fallback: string): string {
  return next && /^\/[\w\-/]*(\?[\w=&%-]*)?$/.test(next) && !next.startsWith("//") ? next : fallback;
}
