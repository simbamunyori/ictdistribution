import "server-only";
import PgBoss from "pg-boss";
import { DEFAULT_TIME_ZONE } from "@/config/app";
import { prisma } from "@/server/db";
import { emailAdapter } from "@/server/email/adapter";
import { deliverDue } from "@/server/email/outbox";
import { env } from "@/server/env";
import { appKey } from "@/server/secrets";

/**
 * Background jobs, on pg-boss in the same PostgreSQL database, so a job
 * and the change that queued it commit together. Each job is safe to run
 * twice: it claims its rows before acting. Later milestones add theirs.
 */

type Job = { name: string; cron?: string; run: () => Promise<unknown> };

export function deliverEmail() {
  const e = env();
  return deliverDue(prisma, emailAdapter(), { appUrl: e.APP_URL, legalName: e.COMPANY_LEGAL_NAME, key: appKey() });
}

const JOBS: Job[] = [
  { name: "email-deliver", cron: "* * * * *", run: deliverEmail },
  {
    // Rates publish once a day; checking every six hours catches each new one the same day.
    name: "exchange-rates",
    cron: "15 */6 * * *",
    run: async () => {
      if (env().RATE_SOURCE === "off") return;
      const { OpenErApiSource, refreshRates } = await import("@/server/pricing/rates");
      return refreshRates(prisma, new OpenErApiSource());
    },
  },
  {
    // Spent sign-in codes and ended sessions, a week on.
    name: "sign-in-cleanup",
    cron: "40 3 * * *",
    run: async () => {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      await prisma.emailCode.deleteMany({ where: { createdAt: { lt: weekAgo } } });
      await prisma.session.deleteMany({ where: { OR: [{ expiresAt: { lt: weekAgo } }, { revokedAt: { lt: weekAgo } }] } });
    },
  },
];

const globalForBoss = globalThis as unknown as { boss?: Promise<PgBoss | null> };

async function start(): Promise<PgBoss | null> {
  if (env().JOBS === "off") return null;
  const boss = new PgBoss({ connectionString: env().DATABASE_URL, schema: "pgboss" });
  boss.on("error", (e) => console.error("Background jobs:", e));
  await boss.start();
  for (const job of JOBS) {
    await boss.createQueue(job.name);
    await boss.work(job.name, async () => {
      await job.run();
    });
    if (job.cron) await boss.schedule(job.name, job.cron, {}, { tz: DEFAULT_TIME_ZONE });
  }
  return boss;
}

export function startJobs(): Promise<PgBoss | null> {
  globalForBoss.boss ??= start().catch((e) => {
    console.error("Background jobs did not start:", e);
    return null;
  });
  return globalForBoss.boss;
}

/** Runs a job now instead of waiting for its schedule, e.g. to send a sign-in code straight away. */
export async function runSoon(name: string) {
  const boss = await startJobs();
  if (boss) await boss.send(name, {});
  // With jobs off (a test server), send email in the request instead.
  else if (name === "email-deliver") await deliverEmail();
}
