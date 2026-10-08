import { PrismaClient } from "@prisma/client";
import { seedDemo, seedReferenceData } from "../src/server/seed";

/**
 * `npm run db:seed`: the reference data every server needs, plus demo
 * customers for development. Safe to run again. In production it adds
 * demo data only with SEED_DEMO=yes, and the server then refuses to
 * start until it is removed (src/server/placeholders.ts).
 */
const db = new PrismaClient();
try {
  const added = await seedReferenceData(db);
  const demo = process.env.NODE_ENV !== "production" || process.env.SEED_DEMO === "yes";
  if (demo) added.push(...(await seedDemo(db)));
  console.log(added.length ? `Added: ${added.join("; ")}` : "Nothing to add.");
} finally {
  await db.$disconnect();
}
