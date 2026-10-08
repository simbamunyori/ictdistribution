import type { PrismaClient } from "@prisma/client";
import type { Env } from "./env";

/**
 * Development values that must never reach customers. In production the
 * server refuses to start while any is still set (src/instrumentation.ts).
 * ALLOW_PLACEHOLDERS=yes lets a demo or CI server start anyway.
 */

/** The demo accounts the seed makes. */
export const DEMO_EMAILS = ["neo@example.co.bw", "kabo@example.co.bw", "lesego@example.co.bw", "staff@example.co.bw"];

const isLocalhost = (value: string) => /@localhost\b|\/\/localhost\b|\/\/127\.0\.0\.1\b/i.test(value);

type PlaceholderEnv = Pick<Env, "APP_URL" | "MAIL_FROM" | "NODE_ENV"> & { SMTP_URL?: string | null };

export async function findPlaceholders(db: Pick<PrismaClient, "user" | "market" | "exchangeRate">, e: PlaceholderEnv): Promise<string[]> {
  const found: string[] = [];
  if (isLocalhost(e.APP_URL)) found.push(`APP_URL is ${e.APP_URL}. Set the public address, https://ictdistribution.africa.`);
  if (isLocalhost(e.MAIL_FROM)) found.push(`MAIL_FROM is ${e.MAIL_FROM}. Set a real sending address.`);
  if (!e.SMTP_URL || isLocalhost(e.SMTP_URL)) found.push("SMTP_URL is not set to a real mail server, so no sign-in code would arrive.");
  for (const m of await db.market.findMany({ where: { supportEmail: { not: null } } })) {
    if (m.supportEmail && /@example\./i.test(m.supportEmail)) found.push(`Market ${m.code}: the support email is ${m.supportEmail}. Set it at /admin/markets/${m.code}.`);
  }
  const seeded = await db.exchangeRate.count({ where: { source: "seed" } });
  if (seeded) found.push(`${seeded} exchange ${seeded === 1 ? "rate is a demo value" : "rates are demo values"}. Fetch real ones at /admin/exchange-rates, or remove them.`);
  const demo = await db.user.findMany({ where: { email: { in: DEMO_EMAILS } }, select: { email: true } });
  if (demo.length) found.push(`Demo accounts exist (${demo.map((u) => u.email).join(", ")}). Remove them.`);
  return found;
}

export async function assertNoPlaceholders(db: Pick<PrismaClient, "user" | "market" | "exchangeRate">, e: PlaceholderEnv, allow = process.env.ALLOW_PLACEHOLDERS === "yes") {
  if (e.NODE_ENV !== "production") return;
  const found = await findPlaceholders(db, e);
  if (!found.length) return;
  const list = found.map((f) => `  - ${f}`).join("\n");
  if (allow) {
    console.warn(`ALLOW_PLACEHOLDERS=yes: starting with development values still set. Never do this for customers.\n${list}`);
    return;
  }
  throw new Error(`Refusing to start in production with development values still set:\n${list}\nFix them, or set ALLOW_PLACEHOLDERS=yes for a demo server.`);
}
