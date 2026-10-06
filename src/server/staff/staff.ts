import type { PrismaClient, StaffRole } from "@prisma/client";
import { audit, staffAudit, SYSTEM_ACTOR } from "@/server/audit";
import { AuthError, clock, createSession, EMAIL_PATTERN, normaliseEmail, signOutEverywhere, type AuthDeps, type RequestContext } from "@/server/auth/service";
import { hashToken, newToken } from "@/server/auth/tokens";
import { queueEmail } from "@/server/email/outbox";
import { DomainError } from "@/server/errors";
import { assertStaffCan, STAFF_ROLE_LABEL, STAFF_ROLES, type StaffActor } from "./access";

/**
 * Staff accounts. An Admin invites a colleague by email with a role; the
 * colleague opens the link and adds a passkey, which they then use at
 * every sign-in. The first Admin is invited from the server with
 * `ictd create-admin` (docs/deploy.md). Nobody has a password.
 */

export const STAFF_INVITATION_TTL_MS = 3 * 24 * 60 * 60 * 1000;

export async function listStaff(db: PrismaClient) {
  const [people, invitations] = await Promise.all([
    db.user.findMany({ where: { kind: "STAFF" }, include: { _count: { select: { passkeys: true } } }, orderBy: [{ deactivatedAt: { sort: "asc", nulls: "first" } }, { name: "asc" }] }),
    db.staffInvitation.findMany({ where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } }),
  ]);
  return { people, invitations };
}

function checkInput(emailInput: string, nameInput: string, role: StaffRole) {
  const email = normaliseEmail(emailInput);
  const name = nameInput.trim().replace(/\s+/g, " ");
  const fieldErrors: Record<string, string> = {};
  if (!EMAIL_PATTERN.test(email)) fieldErrors.email = "Enter a valid email address.";
  if (name.length < 2 || name.length > 100) fieldErrors.name = "Enter their full name.";
  if (!STAFF_ROLES.includes(role)) fieldErrors.role = "Choose a role.";
  if (Object.keys(fieldErrors).length) throw new DomainError("invalid", "Check the highlighted fields.", undefined, fieldErrors);
  return { email, name };
}

/**
 * Makes an invitation and queues its email. Returns the link's token so
 * the server command can print it too. `actor` is null only for the
 * first Admin, made on the server.
 */
export async function inviteStaff(deps: AuthDeps, actor: StaffActor | null, input: { email: string; name: string; role: StaffRole }, ctx: RequestContext = {}): Promise<{ token: string }> {
  if (actor) assertStaffCan(actor, "manageStaff");
  const { email, name } = checkInput(input.email, input.name, input.role);
  const now = clock(deps);
  const token = newToken();
  await deps.db.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { email } });
    if (existing?.kind === "STAFF" && !existing.deactivatedAt) throw new DomainError("conflict", "They already have a staff account.", "email");
    if (existing?.kind === "CUSTOMER") throw new DomainError("conflict", "That address has a customer account. Use their work address.", "email");
    if (existing?.kind === "STAFF") throw new DomainError("conflict", "They have a staff account that is switched off. Switch it back on instead.", "email");
    await tx.staffInvitation.updateMany({ where: { email, acceptedAt: null, revokedAt: null }, data: { revokedAt: now, tokenHash: null } });
    const inv = await tx.staffInvitation.create({ data: { email, name, staffRole: input.role, tokenHash: hashToken(token), invitedById: actor?.userId ?? null, expiresAt: new Date(now.getTime() + STAFF_INVITATION_TTL_MS) } });
    await queueEmail(tx, deps.key, { to: email, kind: "staff.invitation", payload: { name, role: STAFF_ROLE_LABEL[input.role] }, secret: { token } });
    const summary = `Invited ${name} (${email}) as ${STAFF_ROLE_LABEL[input.role]}`;
    await audit(tx, actor ? staffAudit(actor, { action: "staff.invited", summary, targetType: "StaffInvitation", targetId: inv.id, ipAddress: ctx.ipAddress }) : { ...SYSTEM_ACTOR, actorLabel: "Server command", action: "staff.invited", summary, targetType: "StaffInvitation", targetId: inv.id });
  });
  return { token };
}

export async function findStaffInvitation(db: Pick<PrismaClient, "staffInvitation">, token: string) {
  const inv = await db.staffInvitation.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt <= new Date()) return null;
  return inv;
}

/** Opening the link proves the email. Makes the account and a session that must add a passkey next. */
export async function acceptStaffInvitation(deps: AuthDeps, token: string, ctx: RequestContext = {}): Promise<{ token: string }> {
  const now = clock(deps);
  return deps.db.$transaction(async (tx) => {
    const inv = await tx.staffInvitation.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt <= now) throw new AuthError("expired", "This link has expired or was already used. Ask an Admin for a new one.");
    if (await tx.user.findUnique({ where: { email: inv.email } })) throw new AuthError("forbidden", "There is already an account for this address. Ask an Admin.");
    const user = await tx.user.create({ data: { kind: "STAFF", email: inv.email, name: inv.name, staffRole: inv.staffRole, emailVerifiedAt: now } });
    await tx.staffInvitation.update({ where: { id: inv.id }, data: { acceptedAt: now, tokenHash: null, userId: user.id } });
    await audit(tx, { actorKind: "STAFF", actorUserId: user.id, actorLabel: user.name, subjectUserId: user.id, action: "staff.joined", summary: `${user.name} set up their staff account as ${STAFF_ROLE_LABEL[inv.staffRole]}`, ipAddress: ctx.ipAddress });
    return { token: await createSession(tx, user, "PASSKEY_SETUP", null, ctx, now) };
  });
}

export async function revokeStaffInvitation(db: PrismaClient, actor: StaffActor, id: string, ip?: string | null) {
  assertStaffCan(actor, "manageStaff");
  await db.$transaction(async (tx) => {
    const inv = await tx.staffInvitation.findFirst({ where: { id, acceptedAt: null, revokedAt: null } });
    if (!inv) return;
    await tx.staffInvitation.update({ where: { id }, data: { revokedAt: new Date(), tokenHash: null } });
    await audit(tx, staffAudit(actor, { action: "staff.invitation-withdrawn", summary: `Withdrew the invitation to ${inv.email}`, ipAddress: ip }));
  });
}

async function activeAdminsBesides(db: Pick<PrismaClient, "user">, userId: string) {
  return db.user.count({ where: { kind: "STAFF", staffRole: "ADMIN", deactivatedAt: null, id: { not: userId } } });
}

export async function changeStaffRole(db: PrismaClient, actor: StaffActor, userId: string, role: StaffRole, ip?: string | null) {
  assertStaffCan(actor, "manageStaff");
  if (!STAFF_ROLES.includes(role)) throw new DomainError("invalid", "Choose a role.", "role");
  await db.$transaction(async (tx) => {
    const user = await tx.user.findFirst({ where: { id: userId, kind: "STAFF" } });
    if (!user?.staffRole) throw new DomainError("not-found", "No such staff member.");
    if (user.staffRole === role) return;
    if (user.staffRole === "ADMIN" && !(await activeAdminsBesides(tx, user.id))) throw new DomainError("invalid", "There must always be an Admin. Make someone else Admin first.");
    await tx.user.update({ where: { id: user.id }, data: { staffRole: role } });
    await audit(tx, staffAudit(actor, { subjectUserId: user.id, action: "staff.role-changed", summary: `Changed ${user.name} from ${STAFF_ROLE_LABEL[user.staffRole]} to ${STAFF_ROLE_LABEL[role]}`, ipAddress: ip }));
  });
}

/** Switches a staff account off or on. Off ends their sessions at once. */
export async function setStaffActive(db: PrismaClient, actor: StaffActor, userId: string, active: boolean, ip?: string | null) {
  assertStaffCan(actor, "manageStaff");
  if (userId === actor.userId && !active) throw new DomainError("invalid", "You can't switch off your own account.");
  const now = new Date();
  await db.$transaction(async (tx) => {
    const user = await tx.user.findFirst({ where: { id: userId, kind: "STAFF" } });
    if (!user) throw new DomainError("not-found", "No such staff member.");
    if (Boolean(user.deactivatedAt) === !active) return;
    if (!active && user.staffRole === "ADMIN" && !(await activeAdminsBesides(tx, user.id))) throw new DomainError("invalid", "There must always be an Admin.");
    await tx.user.update({ where: { id: user.id }, data: { deactivatedAt: active ? null : now } });
    if (!active) await signOutEverywhere(tx, user.id, now);
    await audit(tx, staffAudit(actor, { subjectUserId: user.id, action: active ? "staff.reactivated" : "staff.deactivated", summary: `${active ? "Switched on" : "Switched off"} ${user.name}'s staff account`, ipAddress: ip }));
  });
}
