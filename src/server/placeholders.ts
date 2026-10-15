import type { PrismaClient } from "@prisma/client";
import type { Env } from "./env";

/**
 * Development values that must never reach customers. In production the
 * server refuses to start while any is still set (src/instrumentation.ts).
 * ALLOW_PLACEHOLDERS=yes lets a demo or CI server start anyway.
 */

/** The demo accounts the seed makes. */
export const DEMO_EMAILS = ["neo@example.co.bw", "kabo@example.co.bw", "lesego@example.co.bw", "staff@example.co.bw"];

/** Demo suppliers end their name with this, and demo products start their part number with DEMO. */
export const DEMO_SUFFIX = "(demo)";
export const DEMO_MPN = "DEMO";

const isLocalhost = (value: string) => /@localhost\b|\/\/localhost\b|\/\/127\.0\.0\.1\b/i.test(value);

type PlaceholderEnv = Pick<Env, "APP_URL" | "MAIL_FROM" | "NODE_ENV"> & { SMTP_URL?: string | null };

type PlaceholderDb = Pick<PrismaClient, "user" | "market" | "exchangeRate" | "supplier" | "product" | "collectionPoint" | "special" | "procurementSettings">;

export async function findPlaceholders(db: PlaceholderDb, e: PlaceholderEnv): Promise<string[]> {
  const found: string[] = [];
  if (isLocalhost(e.APP_URL)) found.push(`APP_URL is ${e.APP_URL}. Set the public address, https://ictdistribution.africa.`);
  if (isLocalhost(e.MAIL_FROM)) found.push(`MAIL_FROM is ${e.MAIL_FROM}. Set a real sending address.`);
  if (!e.SMTP_URL || isLocalhost(e.SMTP_URL)) found.push("SMTP_URL is not set to a real mail server, so no sign-in code would arrive.");
  for (const m of await db.market.findMany()) {
    if (m.supportEmail && /@example\./i.test(m.supportEmail)) found.push(`Market ${m.code}: the support email is ${m.supportEmail}. Set it at /admin/markets/${m.code}.`);
    if (m.bankDetails.includes(DEMO_SUFFIX)) found.push(`Market ${m.code}: the bank details are a demo. Set the real account at /admin/markets/${m.code}.`);
  }
  const demoPoints = await db.collectionPoint.count({ where: { name: { endsWith: DEMO_SUFFIX }, active: true } });
  if (demoPoints) found.push(`${demoPoints} demo collection ${demoPoints === 1 ? "point is" : "points are"} open. Close them at /admin/markets.`);
  const procurement = await db.procurementSettings.findUnique({ where: { id: "global" } });
  if (procurement?.deliverTo.includes(DEMO_SUFFIX)) found.push("The delivery address on purchase orders is a demo. Set it at /admin/purchase-orders/rules.");
  const seeded = await db.exchangeRate.count({ where: { source: "seed" } });
  if (seeded) found.push(`${seeded} exchange ${seeded === 1 ? "rate is a demo value" : "rates are demo values"}. Fetch real ones at /admin/exchange-rates, or remove them.`);
  const demo = await db.user.findMany({ where: { email: { in: DEMO_EMAILS } }, select: { email: true } });
  if (demo.length) found.push(`Demo accounts exist (${demo.map((u) => u.email).join(", ")}). Remove them.`);
  const demoSuppliers = await db.supplier.count({ where: { name: { endsWith: DEMO_SUFFIX } } });
  if (demoSuppliers) found.push(`${demoSuppliers} demo ${demoSuppliers === 1 ? "supplier exists" : "suppliers exist"}. Remove them at /admin/suppliers.`);
  const demoSpecials = await db.special.count({ where: { name: { endsWith: DEMO_SUFFIX }, endsAt: { gt: new Date() } } });
  if (demoSpecials) found.push(`${demoSpecials} demo ${demoSpecials === 1 ? "special is" : "specials are"} still on. End them at /admin/specials.`);
  const demoProducts = await db.product.count({ where: { mpnKey: { startsWith: DEMO_MPN }, status: { not: "ARCHIVED" } } });
  if (demoProducts) found.push(`${demoProducts} demo ${demoProducts === 1 ? "product exists" : "products exist"} (part numbers starting ${DEMO_MPN}). Archive them at /admin/products.`);
  return found;
}

export async function assertNoPlaceholders(db: PlaceholderDb, e: PlaceholderEnv, allow = process.env.ALLOW_PLACEHOLDERS === "yes") {
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
