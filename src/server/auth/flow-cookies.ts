import "server-only";
import type { UserKind } from "@prisma/client";
import { cookies } from "next/headers";
import { appKey } from "@/server/secrets";
import type { PendingIdentity } from "./identities";
import type { OAuthFlow } from "./oauth";
import { open, seal } from "./secret-box";

/**
 * Short-lived state kept in sealed cookies rather than the database: a
 * Microsoft or Google round trip, an account waiting to be linked or
 * signed up, the email a code was sent to, and a passkey challenge. Each
 * is encrypted and authenticated with the app key, names what it is for,
 * and expires on its own.
 */

const SECURE = process.env.NODE_ENV === "production";
const name = (n: string) => (SECURE ? `__Host-ictd_${n}` : `ictd_${n}`);

type Kind = "oauth" | "pending" | "webauthn" | "email";

const LIFETIME: Record<Kind, number> = { oauth: 10 * 60, pending: 30 * 60, webauthn: 5 * 60, email: 15 * 60 };

async function write(kind: Kind, value: object) {
  const expires = Date.now() + LIFETIME[kind] * 1000;
  (await cookies()).set(name(kind), seal(JSON.stringify({ kind, expires, value }), appKey()), {
    httpOnly: true,
    secure: SECURE,
    // The provider sends people back with a top-level GET, which carries lax cookies.
    sameSite: kind === "webauthn" ? "strict" : "lax",
    path: "/",
    maxAge: LIFETIME[kind],
  });
}

async function read<T>(kind: Kind): Promise<T | null> {
  const raw = (await cookies()).get(name(kind))?.value;
  if (!raw) return null;
  try {
    const box = JSON.parse(open(raw, appKey())) as { kind: Kind; expires: number; value: T };
    return box.kind === kind && box.expires > Date.now() ? box.value : null;
  } catch {
    return null;
  }
}

async function clear(kind: Kind) {
  (await cookies()).delete(name(kind));
}

export const saveOAuthFlow = (flow: OAuthFlow) => write("oauth", flow);
/** Read once: the round trip can't be replayed. */
export async function takeOAuthFlow(): Promise<OAuthFlow | null> {
  const flow = await read<OAuthFlow>("oauth");
  await clear("oauth");
  return flow;
}

/**
 * Someone part-way in: a proven email waiting to sign up (from a code, or
 * from Microsoft or Google with the account to link), or a Microsoft or
 * Google account waiting for an emailed code to link to an existing account.
 */
export interface Pending {
  intent: "sign-up" | "link";
  email: string;
  name: string | null;
  identity?: PendingIdentity;
  next?: string;
}
export const savePending = (p: Pending) => write("pending", p);
export const readPending = () => read<Pending>("pending");
export const clearPending = () => clear("pending");

/** The address a sign-in code went to, and where to go after. */
export interface EmailFlow {
  email: string;
  next?: string;
  /** Staff and customers share this cookie; each code page reads only its own. */
  audience?: UserKind;
}
export const saveEmailFlow = (f: EmailFlow) => write("email", f);
export const readEmailFlow = () => read<EmailFlow>("email");
export const clearEmailFlow = () => clear("email");

export type ChallengePurpose = "sign-in" | "second-step" | "setup" | "add" | "step-up";
export interface Challenge {
  challenge: string;
  purpose: ChallengePurpose;
  userId?: string;
}
export const saveChallenge = (c: Challenge) => write("webauthn", c);
/** Each challenge is used once, for the purpose it was made for. */
export async function takeChallenge(purpose: ChallengePurpose, userId?: string): Promise<string | null> {
  const c = await read<Challenge>("webauthn");
  await clear("webauthn");
  return c && c.purpose === purpose && c.userId === userId ? c.challenge : null;
}
