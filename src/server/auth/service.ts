import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { Prisma, PrismaClient, Session, SessionStage, User, UserKind } from "@prisma/client";
import { audit } from "@/server/audit";
import { queueEmail } from "@/server/email/outbox";
import { hashToken, newToken } from "./tokens";

/**
 * Sessions and email codes for customers and staff.
 *
 * Customers sign in with any one of: a code emailed to them, Microsoft,
 * Google or a passkey. Staff also need their passkey every time: an email
 * code or Microsoft is only the first step (src/server/auth/passkeys.ts).
 * There are no passwords.
 *
 * Functions take the database client and key so tests run without Next.js.
 */

/** Customers stay signed in this long without activity. */
export const CUSTOMER_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
/** Staff are signed out sooner. */
export const STAFF_IDLE_MS = 8 * 60 * 60 * 1000;
/** Time allowed between a staff member's first step and their passkey. */
export const PENDING_MS = 10 * 60 * 1000;
/** Avoid a database write on every request. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;
export const CODE_TTL_MS = 10 * 60 * 1000;
export const CODE_MAX_ATTEMPTS = 5;
/** Changing sign-in methods and staff settings need a check this recent. */
export const STEP_UP_MS = 15 * 60 * 1000;

export interface AuthDeps {
  db: PrismaClient;
  /** Base64 32-byte key (APP_SECRET): code hashes and sealed email secrets. */
  key: string;
  now?: () => Date;
}

export interface RequestContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export class AuthError extends Error {
  constructor(
    public readonly code: "invalid-code" | "expired" | "invalid-input" | "no-session" | "forbidden" | "step-up",
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export type SessionWithUser = Session & { user: User };

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function clock(deps: AuthDeps): Date {
  return deps.now ? deps.now() : new Date();
}

const idleMs = (audience: UserKind) => (audience === "STAFF" ? STAFF_IDLE_MS : CUSTOMER_IDLE_MS);

function expiryFor(stage: SessionStage, audience: UserKind, now: Date): Date {
  return new Date(now.getTime() + (stage === "ACTIVE" ? idleMs(audience) : PENDING_MS));
}

// ─── Sessions ────────────────────────────────────────────────────────

export async function createSession(
  tx: Prisma.TransactionClient,
  user: Pick<User, "id" | "kind" | "name">,
  stage: SessionStage,
  organisationId: string | null,
  ctx: RequestContext,
  now: Date,
): Promise<string> {
  const token = newToken();
  await tx.session.create({
    data: {
      tokenHash: hashToken(token),
      userId: user.id,
      audience: user.kind,
      stage,
      activeOrganisationId: organisationId,
      // Every way in proves the person just now.
      stepUpAt: stage === "ACTIVE" ? now : null,
      expiresAt: expiryFor(stage, user.kind, now),
      lastSeenAt: now,
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent?.slice(0, 400) ?? null,
    },
  });
  if (stage === "ACTIVE") await tx.user.update({ where: { id: user.id }, data: { lastSignInAt: now } });
  // Staff sign-ins are in the audit log; customers' are on their sessions.
  if (stage === "ACTIVE" && user.kind === "STAFF") {
    await audit(tx, { actorKind: "STAFF", actorUserId: user.id, actorLabel: user.name, subjectUserId: user.id, action: "staff.signed-in", summary: `${user.name} signed in`, ipAddress: ctx.ipAddress });
  }
  return token;
}

/** The organisation a customer buys for when they sign in: their first, or none. */
export async function primaryOrganisationId(tx: Prisma.TransactionClient | PrismaClient, userId: string): Promise<string | null> {
  const m = await tx.membership.findFirst({ where: { userId, active: true }, orderBy: { createdAt: "asc" }, select: { organisationId: true } });
  return m?.organisationId ?? null;
}

/** A finished sign-in for a customer, or the passkey step for staff. */
export async function startSession(tx: Prisma.TransactionClient, user: User, ctx: RequestContext, now: Date, passkeyDone = false): Promise<{ token: string; stage: SessionStage }> {
  if (user.deactivatedAt) throw new AuthError("forbidden", "This account is switched off. Contact us if you think that's a mistake.");
  if (user.kind === "CUSTOMER") {
    return { token: await createSession(tx, user, "ACTIVE", await primaryOrganisationId(tx, user.id), ctx, now), stage: "ACTIVE" };
  }
  const stage: SessionStage = passkeyDone ? "ACTIVE" : (await tx.passkey.count({ where: { userId: user.id } })) ? "PASSKEY_PENDING" : "PASSKEY_SETUP";
  return { token: await createSession(tx, user, stage, null, ctx, now), stage };
}

export async function getSession(deps: AuthDeps, token: string, audience: UserKind): Promise<SessionWithUser | null> {
  const now = clock(deps);
  const session = await deps.db.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!session || session.revokedAt || session.expiresAt <= now || session.audience !== audience || session.user.kind !== audience || session.user.deactivatedAt) return null;
  if (session.stage === "ACTIVE" && now.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await deps.db.session.update({ where: { id: session.id }, data: { lastSeenAt: now, expiresAt: expiryFor("ACTIVE", audience, now) } });
  }
  return session;
}

export async function requireStage(deps: AuthDeps, token: string | undefined, audience: UserKind, stages: SessionStage[]): Promise<SessionWithUser> {
  const session = token ? await getSession(deps, token, audience) : null;
  if (!session || !stages.includes(session.stage)) throw new AuthError("no-session", "Your sign-in timed out. Start again.");
  return session;
}

/** Moves a staff session on to fully signed in, with a fresh token. */
export async function promote(tx: Prisma.TransactionClient, session: SessionWithUser, ctx: RequestContext, now: Date): Promise<string> {
  await tx.session.update({ where: { id: session.id }, data: { revokedAt: now } });
  return createSession(tx, session.user, "ACTIVE", session.activeOrganisationId, ctx, now);
}

export async function signOut(deps: AuthDeps, token: string | undefined | null) {
  if (!token) return;
  await deps.db.session.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: clock(deps) } });
}

export async function signOutEverywhere(db: Prisma.TransactionClient | PrismaClient, userId: string, now: Date, keepSessionId?: string) {
  await db.session.updateMany({ where: { userId, revokedAt: null, ...(keepSessionId ? { id: { not: keepSessionId } } : {}) }, data: { revokedAt: now } });
}

export const stepUpFresh = (session: Pick<Session, "stepUpAt">, now = new Date()) => Boolean(session.stepUpAt && now.getTime() - session.stepUpAt.getTime() < STEP_UP_MS);

export function assertStepUp(session: Pick<Session, "stepUpAt">, now = new Date()) {
  if (!stepUpFresh(session, now)) throw new AuthError("step-up", "Confirm it's you first.");
}

// ─── Email codes ─────────────────────────────────────────────────────

/** Codes are kept only as an HMAC under the app key, so a database copy can't be used to sign in. */
export function hashCode(key: string, email: string, code: string): string {
  return createHmac("sha256", Buffer.from(key, "base64")).update(`${email}\n${code}`).digest("hex");
}

export function newCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/**
 * Emails a six-digit code. Earlier codes for the address stop working.
 * Staff codes go only to active staff; for anyone else nothing is sent,
 * and the page reads the same either way, so it can't tell who is staff.
 */
export async function requestEmailCode(deps: AuthDeps, emailInput: string, audience: UserKind, ctx: RequestContext = {}): Promise<string> {
  const email = normaliseEmail(emailInput);
  if (!EMAIL_PATTERN.test(email) || email.length > 254) throw new AuthError("invalid-input", "Enter a valid email address.");
  const now = clock(deps);
  if (audience === "STAFF") {
    const staff = await deps.db.user.findUnique({ where: { email } });
    if (!staff || staff.kind !== "STAFF" || staff.deactivatedAt) return email;
  }
  const code = newCode();
  await deps.db.$transaction(async (tx) => {
    await tx.emailCode.updateMany({ where: { email, audience, usedAt: null }, data: { usedAt: now } });
    await tx.emailCode.create({ data: { email, audience, codeHash: hashCode(deps.key, email, code), expiresAt: new Date(now.getTime() + CODE_TTL_MS), ipAddress: ctx.ipAddress ?? null } });
    await queueEmail(tx, deps.key, { to: email, kind: audience === "STAFF" ? "staff.code" : "auth.code", secret: { code } });
  });
  return email;
}

/** Checks a code and uses it up. Five wrong tries and it stops working. */
export async function verifyEmailCode(deps: AuthDeps, emailInput: string, audience: UserKind, codeInput: string): Promise<string> {
  const email = normaliseEmail(emailInput);
  const code = codeInput.replace(/\D/g, "");
  const now = clock(deps);
  const row = await deps.db.emailCode.findFirst({ where: { email, audience, usedAt: null, expiresAt: { gt: now } }, orderBy: { createdAt: "desc" } });
  if (!row || row.attempts >= CODE_MAX_ATTEMPTS) throw new AuthError("expired", "That code has expired. Ask for a new one.");
  const claimed = await deps.db.emailCode.updateMany({ where: { id: row.id, attempts: row.attempts, usedAt: null }, data: { attempts: { increment: 1 } } });
  if (claimed.count !== 1) throw new AuthError("invalid-code", "That code didn't work. Try again.");
  const expected = Buffer.from(row.codeHash, "hex");
  const given = Buffer.from(hashCode(deps.key, email, code), "hex");
  if (code.length !== 6 || !timingSafeEqual(expected, given)) {
    const left = CODE_MAX_ATTEMPTS - row.attempts - 1;
    throw new AuthError(left > 0 ? "invalid-code" : "expired", left > 0 ? "That code didn't work. Check it and try again." : "That code has stopped working. Ask for a new one.");
  }
  const used = await deps.db.emailCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } });
  if (used.count !== 1) throw new AuthError("expired", "That code has already been used. Ask for a new one.");
  return email;
}

export type EmailSignIn = { kind: "session"; token: string; stage: SessionStage } | { kind: "sign-up"; email: string };

/**
 * A customer's email code. Someone new goes on to sign up with the
 * address now proven; staff addresses are refused here.
 */
export async function signInWithEmailCode(deps: AuthDeps, emailInput: string, code: string, audience: UserKind, ctx: RequestContext = {}): Promise<EmailSignIn> {
  const email = await verifyEmailCode(deps, emailInput, audience, code);
  const now = clock(deps);
  const user = await deps.db.user.findUnique({ where: { email } });
  if (!user) {
    if (audience === "STAFF") throw new AuthError("forbidden", "There's no staff account for that address.");
    return { kind: "sign-up", email };
  }
  if (user.kind !== audience) throw new AuthError("forbidden", audience === "CUSTOMER" ? "This is a staff address. Staff sign in at /admin." : "There's no staff account for that address.");
  return deps.db.$transaction(async (tx) => {
    if (!user.emailVerifiedAt) await tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: now } });
    return { kind: "session" as const, ...(await startSession(tx, user, ctx, now)) };
  });
}

/** The recent check with an email code, for someone already signed in. */
export async function stepUpWithEmailCode(deps: AuthDeps, session: SessionWithUser, code: string): Promise<void> {
  if (session.stage !== "ACTIVE") throw new AuthError("no-session", "Sign in again.");
  await verifyEmailCode(deps, session.user.email, session.audience, code);
  await deps.db.session.update({ where: { id: session.id }, data: { stepUpAt: clock(deps) } });
}

// ─── Customer details ────────────────────────────────────────────────

export async function updateProfile(deps: AuthDeps, session: SessionWithUser, input: { name: string; phone?: string }, ctx: RequestContext = {}) {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 100) throw new AuthError("invalid-input", "Enter your name.");
  const phone = input.phone?.trim() || null;
  if (phone && !/^\+?[\d\s()-]{7,20}$/.test(phone)) throw new AuthError("invalid-input", "Enter a phone number with its country code, like +267 71 234 567.");
  await deps.db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: session.userId }, data: { name, phone } });
    await audit(tx, {
      actorKind: session.audience,
      actorUserId: session.userId,
      actorLabel: name,
      subjectUserId: session.userId,
      action: "profile.updated",
      summary: "Changed their name or phone number",
      visibleToCustomer: session.audience === "CUSTOMER",
      ipAddress: ctx.ipAddress,
    });
  });
}
