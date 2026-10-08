/**
 * Shared set-up for tests that use a real PostgreSQL database
 * (TEST_DATABASE_URL, emptied and seeded by tests/global-setup.ts). They
 * are skipped when it isn't set.
 */
import { randomBytes } from "node:crypto";
import { PrismaClient, type OrgRole, type StaffRole } from "@prisma/client";
import { signUp } from "../src/server/accounts/sign-up";
import { open } from "../src/server/auth/secret-box";
import { getSession, type AuthDeps } from "../src/server/auth/service";
import type { Actor } from "../src/server/org/access";
import type { StaffActor } from "../src/server/staff/access";

export const hasDb = Boolean(process.env.TEST_DATABASE_URL);
export const db = hasDb ? new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL }) : (undefined as unknown as PrismaClient);

/** One key for the run, so codes queued by one call can be read by the next. */
export const KEY = randomBytes(32).toString("base64");

export function testDeps(now?: () => Date): AuthDeps {
  return { db, key: KEY, now };
}

export function uniqueEmail(label: string) {
  return `${label}+${Date.now().toString(36)}${randomBytes(3).toString("hex")}@example.co.bw`;
}

/** The sealed secret in the newest queued email to an address: a code or an invitation token. */
export async function lastSecret(to: string, kind?: string): Promise<Record<string, string>> {
  const row = await db.outboundEmail.findFirstOrThrow({ where: { toAddress: to, ...(kind ? { kind } : {}) }, orderBy: { createdAt: "desc" } });
  const sealed = (row.payload as Record<string, string>).sealed;
  return sealed ? (JSON.parse(open(sealed, KEY)) as Record<string, string>) : {};
}

export async function sessionFor(token: string, audience: "CUSTOMER" | "STAFF" = "CUSTOMER") {
  const s = await getSession(testDeps(), token, audience);
  if (!s) throw new Error("no session");
  return s;
}

/** A business customer: an organisation with its owner signed in. */
export async function makeOrganisation(name = "Mogoditshane Networks", type: "BUSINESS" | "RESELLER" | "GOVERNMENT" = "BUSINESS") {
  const email = uniqueEmail("owner");
  const { token, organisationId, userId } = await signUp(testDeps(), { email, name: "Neo Kgosi", country: "BW", organisation: { name, type } });
  const membership = await db.membership.findFirstOrThrow({ where: { organisationId: organisationId!, userId } });
  const owner: Actor & { organisationId: string } = { membershipId: membership.id, userId, name: "Neo Kgosi", role: "OWNER", organisationId: organisationId! };
  return { organisationId: organisationId!, owner, email, token };
}

/** Adds someone to an organisation directly, with a given role. */
export async function addMember(organisationId: string, role: OrgRole, name = "Mpho Dube"): Promise<Actor & { organisationId: string }> {
  const user = await db.user.create({ data: { email: uniqueEmail(role.toLowerCase()), name, emailVerifiedAt: new Date() } });
  const m = await db.membership.create({ data: { organisationId, userId: user.id, role } });
  return { membershipId: m.id, userId: user.id, name, role, organisationId };
}

/** A staff member made directly, with no passkey yet. */
export async function makeStaff(role: StaffRole, name = `${role.toLowerCase()} person`): Promise<StaffActor & { email: string }> {
  const email = uniqueEmail(`staff-${role.toLowerCase()}`);
  const user = await db.user.create({ data: { kind: "STAFF", email, name, staffRole: role, emailVerifiedAt: new Date() } });
  return { userId: user.id, name, staffRole: role, email };
}
