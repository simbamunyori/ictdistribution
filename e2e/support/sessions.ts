import { createHash, randomBytes } from "node:crypto";
import { PrismaClient, type UserKind } from "@prisma/client";

/**
 * Signed-in sessions for browser tests, made straight in the database for
 * the seeded demo accounts. Development and CI databases only: it refuses
 * to run in production.
 */

export const DEMO_CUSTOMER = "kabo@example.co.bw";
export const DEMO_STAFF = "staff@example.co.bw";

const COOKIE: Record<UserKind, string> = { CUSTOMER: "ictd_session", STAFF: "ictd_staff" };

export async function testSession(email: string): Promise<{ name: string; value: string }> {
  if (process.env.NODE_ENV === "production") throw new Error("Test sessions are for development and CI only.");
  const db = new PrismaClient();
  try {
    const user = await db.user.findUniqueOrThrow({ where: { email }, include: { memberships: { where: { active: true }, take: 1 } } });
    const token = randomBytes(32).toString("base64url");
    await db.session.create({
      data: {
        tokenHash: createHash("sha256").update(token).digest("hex"),
        userId: user.id,
        audience: user.kind,
        stage: "ACTIVE",
        activeOrganisationId: user.memberships[0]?.organisationId ?? null,
        expiresAt: new Date(Date.now() + 8 * 3_600_000),
        // Counts as recently checked for the whole run, so sign-in method pages show their buttons.
        stepUpAt: new Date(Date.now() + 8 * 3_600_000),
        userAgent: "test session",
      },
    });
    return { name: COOKIE[user.kind], value: token };
  } finally {
    await db.$disconnect();
  }
}
