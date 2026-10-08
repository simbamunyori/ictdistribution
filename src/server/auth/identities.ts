import type { IdentityProvider, Prisma, User, UserKind } from "@prisma/client";
import { audit } from "@/server/audit";
import { queueEmail } from "@/server/email/outbox";
import { providerName, type ProviderProfile } from "./oauth";
import { assertStepUp, AuthError, clock, normaliseEmail, startSession, verifyEmailCode, type AuthDeps, type RequestContext, type SessionWithUser } from "./service";

/**
 * Microsoft and Google accounts. A linked account signs a customer in; a
 * staff member still needs their passkey after it. An existing account
 * found only by email is never opened straight away: we email that
 * address a code, and once it is entered the account is linked.
 */

export type IdentityOutcome =
  | { kind: "session"; token: string; stage: "ACTIVE" | "PASSKEY_PENDING" | "PASSKEY_SETUP" }
  /** An account with this email exists: confirm with an emailed code, then it links. */
  | { kind: "confirm-link"; email: string }
  /** Nobody has this email: carry on to sign-up with it proven. */
  | { kind: "sign-up"; email: string; name: string | null }
  | { kind: "refused"; reason: "no-email" | "unverified" | "deactivated" | "unknown-staff" | "wrong-door" };

export interface PendingIdentity {
  provider: IdentityProvider;
  subject: string;
  email: string;
  name: string | null;
}

export const pendingFrom = (p: ProviderProfile): PendingIdentity => ({ provider: p.provider, subject: p.subject, email: normaliseEmail(p.email ?? ""), name: p.name });

async function sessionFor(deps: AuthDeps, user: User, ctx: RequestContext): Promise<IdentityOutcome> {
  const now = clock(deps);
  const { token, stage } = await deps.db.$transaction((tx) => startSession(tx, user, ctx, now));
  return { kind: "session", token, stage };
}

export async function signInWithProfile(deps: AuthDeps, profile: ProviderProfile, audience: UserKind, ctx: RequestContext = {}): Promise<IdentityOutcome> {
  const now = clock(deps);
  const linked = await deps.db.externalIdentity.findUnique({ where: { provider_subject: { provider: profile.provider, subject: profile.subject } }, include: { user: true } });
  if (linked) {
    if (linked.user.kind !== audience) return { kind: "refused", reason: audience === "STAFF" ? "unknown-staff" : "wrong-door" };
    if (linked.user.deactivatedAt) return { kind: "refused", reason: "deactivated" };
    await deps.db.externalIdentity.update({ where: { id: linked.id }, data: { lastUsedAt: now, ...(profile.email ? { email: normaliseEmail(profile.email) } : {}) } });
    return sessionFor(deps, linked.user, ctx);
  }

  if (!profile.email) return { kind: "refused", reason: "no-email" };
  if (!profile.emailVerified) return { kind: "refused", reason: "unverified" };
  const email = normaliseEmail(profile.email);
  const user = await deps.db.user.findUnique({ where: { email } });

  if (audience === "STAFF") {
    // Staff come only from our own Microsoft tenant, whose addresses we manage; their passkey is still asked for.
    if (!user || user.kind !== "STAFF") return { kind: "refused", reason: "unknown-staff" };
    if (user.deactivatedAt) return { kind: "refused", reason: "deactivated" };
    await deps.db.$transaction(async (tx) => {
      await tx.externalIdentity.deleteMany({ where: { userId: user.id, provider: profile.provider } });
      await tx.externalIdentity.create({ data: { userId: user.id, provider: profile.provider, subject: profile.subject, email, lastUsedAt: now } });
    });
    return sessionFor(deps, user, ctx);
  }

  if (user) {
    if (user.kind !== "CUSTOMER") return { kind: "refused", reason: "wrong-door" };
    if (user.deactivatedAt) return { kind: "refused", reason: "deactivated" };
    return { kind: "confirm-link", email };
  }
  return { kind: "sign-up", email, name: profile.name };
}

/** The emailed code for an account found by email: links the Microsoft or Google account and signs in. */
export async function confirmLinkWithCode(deps: AuthDeps, pending: PendingIdentity, code: string, ctx: RequestContext = {}): Promise<{ token: string }> {
  const email = await verifyEmailCode(deps, pending.email, "CUSTOMER", code);
  const now = clock(deps);
  return deps.db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { email } });
    if (!user || user.kind !== "CUSTOMER") throw new AuthError("forbidden", "There's no account for that address any more.");
    await link(tx, user, pending, now);
    await recordChange(tx, deps.key, user, `Your ${providerName(pending.provider)} account`, true, ctx);
    const { token } = await startSession(tx, user, ctx, now);
    return { token };
  });
}

async function link(tx: Prisma.TransactionClient, user: Pick<User, "id" | "email">, pending: PendingIdentity, now: Date) {
  const taken = await tx.externalIdentity.findUnique({ where: { provider_subject: { provider: pending.provider, subject: pending.subject } } });
  if (taken && taken.userId !== user.id) throw new AuthError("invalid-input", `That ${providerName(pending.provider)} account is already linked to someone else.`);
  await tx.externalIdentity.deleteMany({ where: { userId: user.id, provider: pending.provider } });
  await tx.externalIdentity.create({ data: { userId: user.id, provider: pending.provider, subject: pending.subject, email: user.email, lastUsedAt: now } });
}

export async function recordChange(tx: Prisma.TransactionClient, key: string, user: Pick<User, "id" | "name" | "email" | "kind">, what: string, added: boolean, ctx: RequestContext) {
  await audit(tx, {
    actorKind: user.kind,
    actorUserId: user.id,
    actorLabel: user.name,
    subjectUserId: user.id,
    action: added ? "sign-in.method-added" : "sign-in.method-removed",
    summary: `${added ? "Added" : "Removed"} a way to sign in: ${what.charAt(0).toLowerCase()}${what.slice(1)}`,
    visibleToCustomer: user.kind === "CUSTOMER",
    ipAddress: ctx.ipAddress,
  });
  if (added) await queueEmail(tx, key, { to: user.email, kind: "security.method-added", payload: { what } });
}

/** Links a Microsoft or Google account to someone signed in, after a recent check. Same email only. */
export async function linkIdentity(deps: AuthDeps, session: SessionWithUser, pending: PendingIdentity, ctx: RequestContext = {}): Promise<void> {
  const now = clock(deps);
  if (session.stage !== "ACTIVE") throw new AuthError("no-session", "Sign in again.");
  assertStepUp(session, now);
  if (normaliseEmail(pending.email) !== session.user.email) throw new AuthError("invalid-input", `That ${providerName(pending.provider)} account is for a different email.`);
  await deps.db.$transaction(async (tx) => {
    await link(tx, session.user, pending, now);
    await recordChange(tx, deps.key, session.user, `Your ${providerName(pending.provider)} account`, true, ctx);
  });
}

/** Unlinks a Microsoft or Google account. An emailed code always remains a way in. */
export async function unlinkIdentity(deps: AuthDeps, session: SessionWithUser, provider: IdentityProvider, ctx: RequestContext = {}): Promise<void> {
  if (session.stage !== "ACTIVE") throw new AuthError("no-session", "Sign in again.");
  assertStepUp(session, clock(deps));
  await deps.db.$transaction(async (tx) => {
    const { count } = await tx.externalIdentity.deleteMany({ where: { userId: session.userId, provider } });
    if (count) await recordChange(tx, deps.key, session.user, `Your ${providerName(provider)} account`, false, ctx);
  });
}
