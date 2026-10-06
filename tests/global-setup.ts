import { PrismaClient } from "@prisma/client";
import { seedReferenceData } from "../src/server/seed";

/**
 * Before the database tests: empties TEST_DATABASE_URL and adds the
 * reference data, so every run starts from the same place. Refuses any
 * database whose name doesn't end in _test, so it can't empty a real one.
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  if (!new URL(url).pathname.endsWith("_test")) throw new Error("TEST_DATABASE_URL must name a database ending in _test; the tests empty it.");
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    // TRUNCATE skips the audit log's row triggers, which is what a test reset wants and the app never does.
    if (tables.length) await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
    await seedReferenceData(db);
  } finally {
    await db.$disconnect();
  }
}
