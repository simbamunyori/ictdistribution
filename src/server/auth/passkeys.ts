import type { Passkey, UserKind } from "@prisma/client";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { recordChange } from "./identities";
import { assertStepUp, AuthError, clock, promote, requireStage, startSession, type AuthDeps, type RequestContext, type SessionWithUser } from "./service";

/**
 * Passkeys: the fingerprint, face or PIN that unlocks the person's device.
 * One is a way in on its own for anyone, since it is already two factors.
 * Staff must use theirs at every sign-in, so a staff account always has
 * at least one. Every passkey must verify the person (not just a tap),
 * and each challenge is used once (src/server/auth/flow-cookies.ts).
 */

/** The site passkeys belong to: the platform's own address. */
export interface RelyingParty {
  id: string;
  name: string;
  origin: string;
}

export function relyingParty(appUrl: string, name: string): RelyingParty {
  const u = new URL(appUrl);
  return { id: u.hostname, name, origin: u.origin };
}

const MAX_PASSKEYS = 10;

/** A name for the list, from the browser that made it. */
export function passkeyName(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  const device = /iPhone|iPad/.test(ua) ? "iPhone or iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "this device";
  return `Passkey on ${device}`;
}

export async function registrationOptions(deps: AuthDeps, rp: RelyingParty, user: { id: string; email: string; name: string }): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const existing = await deps.db.passkey.findMany({ where: { userId: user.id }, select: { credentialId: true, transports: true } });
  if (existing.length >= MAX_PASSKEYS) throw new AuthError("invalid-input", `You have ${MAX_PASSKEYS} passkeys. Remove one first.`);
  return generateRegistrationOptions({
    rpName: rp.name,
    rpID: rp.id,
    userName: user.email,
    userDisplayName: user.name,
    userID: new TextEncoder().encode(user.id),
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({ id: p.credentialId, transports: p.transports as never })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
}

export function authenticationOptions(rp: RelyingParty, credentials: Pick<Passkey, "credentialId" | "transports">[] = []): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return generateAuthenticationOptions({
    rpID: rp.id,
    userVerification: "required",
    allowCredentials: credentials.map((c) => ({ id: c.credentialId, transports: c.transports as never })),
  });
}

/** Options for someone already part-way in: only their own passkeys. */
export async function authenticationOptionsFor(deps: AuthDeps, rp: RelyingParty, userId: string) {
  const mine = await deps.db.passkey.findMany({ where: { userId }, select: { credentialId: true, transports: true } });
  if (!mine.length) throw new AuthError("invalid-input", "You have no passkey yet.");
  return authenticationOptions(rp, mine);
}

async function verifyRegistration(rp: RelyingParty, response: RegistrationResponseJSON, challenge: string) {
  const result = await verifyRegistrationResponse({ response, expectedChallenge: challenge, expectedOrigin: rp.origin, expectedRPID: rp.id, requireUserVerification: true }).catch(() => null);
  if (!result?.verified) throw new AuthError("invalid-code", "The passkey couldn't be saved. Try again.");
  const { credential, credentialBackedUp } = result.registrationInfo;
  return { credentialId: credential.id, publicKey: Buffer.from(credential.publicKey), counter: credential.counter, transports: credential.transports ?? [], backedUp: credentialBackedUp };
}

/** Checks a passkey and moves its counter on. Optionally only one person's passkeys. */
export async function verifyPasskey(deps: AuthDeps, rp: RelyingParty, response: AuthenticationResponseJSON, challenge: string, userId?: string) {
  const now = clock(deps);
  const passkey = await deps.db.passkey.findUnique({ where: { credentialId: response.id }, include: { user: true } });
  if (!passkey || (userId && passkey.userId !== userId)) throw new AuthError("invalid-code", "That passkey isn't one we know. Use another way to sign in.");
  const result = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.id,
    requireUserVerification: true,
    credential: { id: passkey.credentialId, publicKey: new Uint8Array(passkey.publicKey), counter: passkey.counter, transports: passkey.transports as never },
  }).catch(() => null);
  if (!result?.verified) throw new AuthError("invalid-code", "The passkey didn't work. Try again.");
  // A counter that goes backwards means a copied passkey; synced passkeys always report 0.
  const next = result.authenticationInfo.newCounter;
  if (passkey.counter > 0 && next <= passkey.counter) throw new AuthError("invalid-code", "The passkey didn't work. Try again.");
  const moved = await deps.db.passkey.updateMany({
    where: { id: passkey.id, counter: passkey.counter },
    data: { counter: next, lastUsedAt: now, backedUp: result.authenticationInfo.credentialBackedUp },
  });
  if (moved.count !== 1) throw new AuthError("invalid-code", "The passkey didn't work. Try again.");
  return passkey;
}

/** Signs in with a passkey alone. */
export async function signInWithPasskey(deps: AuthDeps, rp: RelyingParty, response: AuthenticationResponseJSON, challenge: string, audience: UserKind, ctx: RequestContext = {}): Promise<{ token: string }> {
  const now = clock(deps);
  const { user } = await verifyPasskey(deps, rp, response, challenge);
  if (user.kind !== audience) throw new AuthError("invalid-code", "That passkey isn't one we know. Use another way to sign in.");
  return deps.db.$transaction(async (tx) => ({ token: (await startSession(tx, user, ctx, now, true)).token }));
}

/** Staff: the passkey after an email code or Microsoft. */
export async function completeWithPasskey(deps: AuthDeps, rp: RelyingParty, token: string | undefined, response: AuthenticationResponseJSON, challenge: string, ctx: RequestContext = {}): Promise<{ token: string }> {
  const now = clock(deps);
  const session = await requireStage(deps, token, "STAFF", ["PASSKEY_PENDING"]);
  await verifyPasskey(deps, rp, response, challenge, session.userId);
  return { token: await deps.db.$transaction((tx) => promote(tx, session, ctx, now)) };
}

/** Staff without a passkey yet (a new account): adds their first and finishes signing in. */
export async function setupFirstPasskey(deps: AuthDeps, rp: RelyingParty, token: string | undefined, response: RegistrationResponseJSON, challenge: string, ctx: RequestContext = {}): Promise<{ token: string }> {
  const now = clock(deps);
  const session = await requireStage(deps, token, "STAFF", ["PASSKEY_SETUP"]);
  const saved = await verifyRegistration(rp, response, challenge);
  return {
    token: await deps.db.$transaction(async (tx) => {
      await tx.passkey.create({ data: { userId: session.userId, ...saved, name: passkeyName(ctx.userAgent), lastUsedAt: now } });
      await recordChange(tx, deps.key, session.user, `A passkey (${passkeyName(ctx.userAgent)})`, true, ctx);
      return promote(tx, session, ctx, now);
    }),
  };
}

/** The recent check with a passkey. */
export async function stepUpWithPasskey(deps: AuthDeps, rp: RelyingParty, session: SessionWithUser, response: AuthenticationResponseJSON, challenge: string): Promise<void> {
  if (session.stage !== "ACTIVE") throw new AuthError("no-session", "Sign in again.");
  await verifyPasskey(deps, rp, response, challenge, session.userId);
  await deps.db.session.update({ where: { id: session.id }, data: { stepUpAt: clock(deps) } });
}

/** Adds a passkey for someone signed in, after a recent check. */
export async function addPasskey(deps: AuthDeps, rp: RelyingParty, session: SessionWithUser, response: RegistrationResponseJSON, challenge: string, ctx: RequestContext = {}): Promise<Passkey> {
  const now = clock(deps);
  if (session.stage !== "ACTIVE") throw new AuthError("no-session", "Sign in again.");
  assertStepUp(session, now);
  const saved = await verifyRegistration(rp, response, challenge);
  return deps.db.$transaction(async (tx) => {
    if ((await tx.passkey.count({ where: { userId: session.userId } })) >= MAX_PASSKEYS) throw new AuthError("invalid-input", `You have ${MAX_PASSKEYS} passkeys. Remove one first.`);
    const passkey = await tx.passkey.create({ data: { userId: session.userId, ...saved, name: passkeyName(ctx.userAgent) } });
    await recordChange(tx, deps.key, session.user, `A passkey (${passkey.name})`, true, ctx);
    return passkey;
  });
}

/** Removes a passkey. Staff keep at least one, since they need it to sign in. */
export async function removePasskey(deps: AuthDeps, session: SessionWithUser, passkeyId: string, ctx: RequestContext = {}): Promise<void> {
  if (session.stage !== "ACTIVE") throw new AuthError("no-session", "Sign in again.");
  assertStepUp(session, clock(deps));
  await deps.db.$transaction(async (tx) => {
    const passkey = await tx.passkey.findFirst({ where: { id: passkeyId, userId: session.userId } });
    if (!passkey) return;
    if (session.user.kind === "STAFF" && (await tx.passkey.count({ where: { userId: session.userId } })) <= 1) {
      throw new AuthError("invalid-input", "Staff need a passkey to sign in. Add another one before removing this one.");
    }
    await tx.passkey.delete({ where: { id: passkey.id } });
    await recordChange(tx, deps.key, session.user, `A passkey (${passkey.name})`, false, ctx);
  });
}

export async function renamePasskey(deps: AuthDeps, session: SessionWithUser, passkeyId: string, name: string): Promise<void> {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 60);
  if (!clean) throw new AuthError("invalid-input", "Give the passkey a name.");
  await deps.db.passkey.updateMany({ where: { id: passkeyId, userId: session.userId }, data: { name: clean } });
}
