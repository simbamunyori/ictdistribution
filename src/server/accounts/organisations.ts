import type { CustomerTypeCode, OrgRole, PrismaClient } from "@prisma/client";
import { audit, staffAudit } from "@/server/audit";
import { AuthError, clock, EMAIL_PATTERN, normaliseEmail, type AuthDeps, type RequestContext, type SessionWithUser } from "@/server/auth/service";
import { hashToken, newToken } from "@/server/auth/tokens";
import { queueEmail } from "@/server/email/outbox";
import { DomainError } from "@/server/errors";
import { assertCan, ORG_ROLE_LABEL, type Actor } from "@/server/org/access";
import { ORGANISATION_TYPES } from "@/server/pricing/customer-types";
import { assertStaffCan, type StaffActor } from "@/server/staff/access";

/**
 * Business customers' accounts: who belongs, in which role, and which
 * organisation someone is buying for right now. Every change is in the
 * organisation's history (the audit log, visible to its members).
 */

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface OrganisationChoice {
  id: string;
  name: string;
  role: OrgRole;
  customerType: CustomerTypeCode;
}

export async function organisationsFor(db: Pick<PrismaClient, "membership">, userId: string): Promise<OrganisationChoice[]> {
  const rows = await db.membership.findMany({ where: { userId, active: true }, include: { organisation: true }, orderBy: { createdAt: "asc" } });
  return rows.map((m) => ({ id: m.organisationId, name: m.organisation.name, role: m.role, customerType: m.organisation.customerType }));
}

/** The member acting for the session's organisation, or null when buying for themselves. */
export async function actorFor(db: Pick<PrismaClient, "membership">, session: SessionWithUser): Promise<(Actor & { organisationId: string }) | null> {
  if (!session.activeOrganisationId) return null;
  const m = await db.membership.findUnique({ where: { organisationId_userId: { organisationId: session.activeOrganisationId, userId: session.userId } } });
  if (!m || !m.active) return null;
  return { membershipId: m.id, userId: session.userId, name: session.user.name, role: m.role, organisationId: m.organisationId };
}

/** Buy for an organisation they belong to, or for themselves (null). */
export async function switchOrganisation(deps: AuthDeps, session: SessionWithUser, organisationId: string | null) {
  if (organisationId) {
    const m = await deps.db.membership.findUnique({ where: { organisationId_userId: { organisationId, userId: session.userId } } });
    if (!m || !m.active) throw new DomainError("forbidden", "You're not part of that organisation.");
  }
  await deps.db.session.update({ where: { id: session.id }, data: { activeOrganisationId: organisationId } });
}

export async function listMembers(db: PrismaClient, organisationId: string) {
  const [members, invitations] = await Promise.all([
    db.membership.findMany({ where: { organisationId, active: true }, include: { user: { select: { name: true, email: true } } }, orderBy: { createdAt: "asc" } }),
    db.invitation.findMany({ where: { organisationId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } }),
  ]);
  return { members, invitations };
}

export async function inviteMember(deps: AuthDeps, actor: Actor & { organisationId: string }, emailInput: string, role: OrgRole, ctx: RequestContext = {}) {
  assertCan(actor, "manageTeam");
  const email = normaliseEmail(emailInput);
  if (!EMAIL_PATTERN.test(email)) throw new DomainError("invalid", "Enter a valid email address.", "email");
  const now = clock(deps);
  const token = newToken();
  await deps.db.$transaction(async (tx) => {
    const org = await tx.organisation.findUniqueOrThrow({ where: { id: actor.organisationId } });
    const existing = await tx.membership.findFirst({ where: { organisationId: org.id, active: true, user: { email } } });
    if (existing) throw new DomainError("conflict", "They're already in the team.", "email");
    const staff = await tx.user.findFirst({ where: { email, kind: "STAFF" } });
    if (staff) throw new DomainError("invalid", "That address belongs to our staff and can't join a customer account.", "email");
    // A new invitation replaces any earlier one to the same address.
    await tx.invitation.updateMany({ where: { organisationId: org.id, email, acceptedAt: null, revokedAt: null }, data: { revokedAt: now, tokenHash: null } });
    const invitation = await tx.invitation.create({
      data: { organisationId: org.id, email, role, tokenHash: hashToken(token), invitedById: actor.userId, expiresAt: new Date(now.getTime() + INVITATION_TTL_MS) },
    });
    await queueEmail(tx, deps.key, { to: email, kind: "org.invitation", payload: { inviter: actor.name, organisation: org.name, role: ORG_ROLE_LABEL[role] }, secret: { token } });
    await audit(tx, {
      actorKind: "CUSTOMER",
      actorUserId: actor.userId,
      actorLabel: actor.name,
      organisationId: org.id,
      action: "member.invited",
      summary: `Invited ${email} as ${ORG_ROLE_LABEL[role]}`,
      targetType: "Invitation",
      targetId: invitation.id,
      visibleToCustomer: true,
      ipAddress: ctx.ipAddress,
    });
  });
}

export async function revokeInvitation(deps: AuthDeps, actor: Actor & { organisationId: string }, invitationId: string, ctx: RequestContext = {}) {
  assertCan(actor, "manageTeam");
  await deps.db.$transaction(async (tx) => {
    const inv = await tx.invitation.findFirst({ where: { id: invitationId, organisationId: actor.organisationId, acceptedAt: null, revokedAt: null } });
    if (!inv) return;
    await tx.invitation.update({ where: { id: inv.id }, data: { revokedAt: clock(deps), tokenHash: null } });
    await audit(tx, { actorKind: "CUSTOMER", actorUserId: actor.userId, actorLabel: actor.name, organisationId: actor.organisationId, action: "member.invitation-withdrawn", summary: `Withdrew the invitation to ${inv.email}`, visibleToCustomer: true, ipAddress: ctx.ipAddress });
  });
}

export async function findInvitation(db: Pick<PrismaClient, "invitation">, token: string) {
  const inv = await db.invitation.findUnique({ where: { tokenHash: hashToken(token) }, include: { organisation: { select: { name: true } } } });
  if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt <= new Date()) return null;
  return inv;
}

/** The signed-in person accepts. The invitation must be for their email. */
export async function acceptInvitation(deps: AuthDeps, session: SessionWithUser, token: string, ctx: RequestContext = {}): Promise<string> {
  const now = clock(deps);
  return deps.db.$transaction(async (tx) => {
    const inv = await tx.invitation.findUnique({ where: { tokenHash: hashToken(token) }, include: { organisation: true } });
    if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt <= now) throw new DomainError("not-found", "This invitation has expired or was withdrawn. Ask for a new one.");
    if (inv.email !== session.user.email) throw new AuthError("forbidden", `This invitation is for ${inv.email}. Sign in with that address to accept it.`);
    await tx.membership.upsert({
      where: { organisationId_userId: { organisationId: inv.organisationId, userId: session.userId } },
      create: { organisationId: inv.organisationId, userId: session.userId, role: inv.role },
      update: { role: inv.role, active: true },
    });
    await tx.invitation.update({ where: { id: inv.id }, data: { acceptedAt: now, tokenHash: null } });
    await tx.session.update({ where: { id: session.id }, data: { activeOrganisationId: inv.organisationId } });
    await audit(tx, {
      actorKind: "CUSTOMER",
      actorUserId: session.userId,
      actorLabel: session.user.name,
      organisationId: inv.organisationId,
      action: "member.joined",
      summary: `${session.user.name} joined as ${ORG_ROLE_LABEL[inv.role]}`,
      visibleToCustomer: true,
      ipAddress: ctx.ipAddress,
    });
    return inv.organisationId;
  });
}

async function ownersLeft(tx: Pick<PrismaClient, "membership">, organisationId: string, excludingMembershipId: string) {
  return tx.membership.count({ where: { organisationId, active: true, role: "OWNER", id: { not: excludingMembershipId } } });
}

export async function changeRole(deps: AuthDeps, actor: Actor & { organisationId: string }, membershipId: string, role: OrgRole, ctx: RequestContext = {}) {
  assertCan(actor, "manageTeam");
  await deps.db.$transaction(async (tx) => {
    const m = await tx.membership.findFirst({ where: { id: membershipId, organisationId: actor.organisationId, active: true }, include: { user: true } });
    if (!m) throw new DomainError("not-found", "They're no longer in the team.");
    if (m.role === role) return;
    if (m.role === "OWNER" && !(await ownersLeft(tx, actor.organisationId, m.id))) throw new DomainError("invalid", "Every organisation needs an Owner. Make someone else Owner first.");
    await tx.membership.update({ where: { id: m.id }, data: { role } });
    await audit(tx, {
      actorKind: "CUSTOMER",
      actorUserId: actor.userId,
      actorLabel: actor.name,
      organisationId: actor.organisationId,
      action: "member.role-changed",
      summary: `Changed ${m.user.name} from ${ORG_ROLE_LABEL[m.role]} to ${ORG_ROLE_LABEL[role]}`,
      visibleToCustomer: true,
      ipAddress: ctx.ipAddress,
    });
  });
}

/** Removes someone (or lets someone leave, when it is their own membership). Their sessions stop buying for the organisation. */
export async function removeMember(deps: AuthDeps, actor: Actor & { organisationId: string }, membershipId: string, ctx: RequestContext = {}) {
  const leaving = membershipId === actor.membershipId;
  if (!leaving) assertCan(actor, "manageTeam");
  await deps.db.$transaction(async (tx) => {
    const m = await tx.membership.findFirst({ where: { id: membershipId, organisationId: actor.organisationId, active: true }, include: { user: true } });
    if (!m) return;
    if (m.role === "OWNER" && !(await ownersLeft(tx, actor.organisationId, m.id))) throw new DomainError("invalid", "Every organisation needs an Owner. Make someone else Owner first.");
    await tx.membership.update({ where: { id: m.id }, data: { active: false } });
    await tx.session.updateMany({ where: { userId: m.userId, activeOrganisationId: actor.organisationId }, data: { activeOrganisationId: null } });
    await audit(tx, {
      actorKind: "CUSTOMER",
      actorUserId: actor.userId,
      actorLabel: actor.name,
      organisationId: actor.organisationId,
      action: leaving ? "member.left" : "member.removed",
      summary: leaving ? `${m.user.name} left the team` : `Removed ${m.user.name} from the team`,
      visibleToCustomer: true,
      ipAddress: ctx.ipAddress,
    });
  });
}

/** A business customer's history, for its members. */
export async function organisationHistory(db: Pick<PrismaClient, "auditEvent">, organisationId: string, take = 50) {
  return db.auditEvent.findMany({ where: { organisationId, visibleToCustomer: true }, orderBy: { createdAt: "desc" }, take });
}

// ─── Staff ───────────────────────────────────────────────────────────

export async function listCustomers(db: PrismaClient, actor: StaffActor, filter: { type?: CustomerTypeCode; q?: string } = {}) {
  assertStaffCan(actor, "viewCustomers");
  const q = filter.q?.trim();
  const [organisations, individuals] = await Promise.all([
    filter.type === "INDIVIDUAL"
      ? []
      : db.organisation.findMany({
          where: { ...(filter.type ? { customerType: filter.type } : {}), ...(q ? { name: { contains: q, mode: "insensitive" } } : {}) },
          include: { _count: { select: { memberships: { where: { active: true } } } } },
          orderBy: { createdAt: "desc" },
          take: 100,
        }),
    filter.type && filter.type !== "INDIVIDUAL"
      ? []
      : db.user.findMany({
          where: { kind: "CUSTOMER", memberships: { none: { active: true } }, ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {}) },
          orderBy: { createdAt: "desc" },
          take: 100,
        }),
  ]);
  return { organisations, individuals };
}

/** Staff move a business customer to another type, e.g. Business to Reseller. The customer sees it in their history. */
export async function setOrganisationType(db: PrismaClient, actor: StaffActor, organisationId: string, type: CustomerTypeCode, ip?: string | null) {
  assertStaffCan(actor, "manageCustomers");
  if (!ORGANISATION_TYPES.includes(type)) throw new DomainError("invalid", "An organisation is a Business, Reseller or Government and enterprise buyer.", "type");
  await db.$transaction(async (tx) => {
    const org = await tx.organisation.findUnique({ where: { id: organisationId }, include: { type: true } });
    if (!org) throw new DomainError("not-found", "No such customer.");
    if (org.customerType === type) return;
    const next = await tx.customerType.findUniqueOrThrow({ where: { code: type } });
    await tx.organisation.update({ where: { id: org.id }, data: { customerType: type } });
    await audit(tx, staffAudit(actor, { organisationId: org.id, action: "organisation.type-changed", summary: `Changed the account type from ${org.type.name} to ${next.name}`, ipAddress: ip }));
  });
}

/** Someone already signed in sets up their organisation and becomes its Owner, then buys for it. */
export async function createOrganisation(
  deps: AuthDeps,
  session: SessionWithUser,
  input: { name: string; type: CustomerTypeCode; country: string; registrationNumber?: string; taxNumber?: string },
  ctx: RequestContext = {},
): Promise<string> {
  const name = input.name.trim().replace(/\s+/g, " ");
  const country = input.country.trim().toUpperCase();
  const fieldErrors: Record<string, string> = {};
  if (name.length < 2 || name.length > 120) fieldErrors.organisation = "Enter the organisation's name.";
  if (!ORGANISATION_TYPES.includes(input.type)) fieldErrors.organisationType = "Choose what kind of organisation it is.";
  const market = await deps.db.market.findFirst({ where: { country, enabled: true } });
  if (!market) fieldErrors.country = "We don't sell in that country yet.";
  if (Object.keys(fieldErrors).length || !market) throw new DomainError("invalid", "Check the highlighted fields.", undefined, fieldErrors);
  return deps.db.$transaction(async (tx) => {
    const org = await tx.organisation.create({
      data: { name, customerType: input.type, country, marketCode: market.code, registrationNumber: input.registrationNumber?.trim() || null, taxNumber: input.taxNumber?.trim() || null },
    });
    await tx.membership.create({ data: { organisationId: org.id, userId: session.userId, role: "OWNER" } });
    await tx.session.update({ where: { id: session.id }, data: { activeOrganisationId: org.id } });
    await audit(tx, { actorKind: "CUSTOMER", actorUserId: session.userId, actorLabel: session.user.name, organisationId: org.id, action: "organisation.created", summary: `Set up ${name} and became its Owner`, visibleToCustomer: true, ipAddress: ctx.ipAddress });
    return org.id;
  });
}
