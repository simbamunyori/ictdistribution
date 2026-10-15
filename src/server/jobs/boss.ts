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

/** `inline` jobs run in the request when jobs are off (a test server), so their effect is still seen. */
type Job = { name: string; cron?: string; inline?: boolean; run: () => Promise<unknown> };

export function deliverEmail() {
  const e = env();
  return deliverDue(prisma, emailAdapter(), { appUrl: e.APP_URL, legalName: e.COMPANY_LEGAL_NAME, key: appKey() });
}

const JOBS: Job[] = [
  { name: "email-deliver", cron: "* * * * *", inline: true, run: deliverEmail },
  {
    // Requests for quote: read new ones, price those whose suppliers have answered or run out of time, expire old quotes, remind Sales of tenders.
    name: "quotes",
    cron: "*/5 * * * *",
    inline: true,
    run: async () => {
      const { quoteTick } = await import("@/server/quotes/tick");
      const result = await quoteTick(prisma, { key: appKey(), replyTo: env().QUOTES_EMAIL });
      await deliverEmail();
      return result;
    },
  },
  {
    // Purchase orders for orders paid or put on account (docs/procurement.md). Placing and paying an order start it at once; this catches the rest.
    name: "procurement",
    cron: "*/5 * * * *",
    inline: true,
    run: async () => {
      const { procureWaiting } = await import("@/server/procurement/purchase-orders");
      const made = await procureWaiting(prisma, { key: appKey(), replyTo: env().QUOTES_EMAIL });
      await deliverEmail();
      return made;
    },
  },
  {
    // The quotes mailbox: emailed requests and supplier replies (docs/quotes.md). Off while IMAP_URL is unset.
    name: "quote-mailbox",
    cron: "*/2 * * * *",
    run: async () => {
      const e = env();
      if (!e.IMAP_URL) return 0;
      const { pollMailbox } = await import("@/server/quotes/mailbox");
      const own = [e.QUOTES_EMAIL, /<([^>]+)>/.exec(e.MAIL_FROM)?.[1] ?? e.MAIL_FROM].filter((a): a is string => Boolean(a));
      const n = await pollMailbox(prisma, { key: appKey(), replyTo: e.QUOTES_EMAIL, ownAddresses: own }, e.IMAP_URL);
      if (n) await runSoon("quotes");
      return n;
    },
  },
  {
    // Rates publish once a day; checking every six hours catches each new one the same day.
    name: "exchange-rates",
    cron: "15 */6 * * *",
    run: async () => {
      if (env().RATE_SOURCE === "off") return;
      const { OpenErApiSource, refreshRates } = await import("@/server/pricing/rates");
      const { refreshCosts } = await import("@/server/shop/costs");
      const result = await refreshRates(prisma, new OpenErApiSource());
      await refreshCosts(prisma);
      return result;
    },
  },
  {
    // Supplier price lists on a schedule (/admin/suppliers). Each run fetches only the ones that are due.
    name: "price-lists",
    cron: "5 * * * *",
    run: async () => {
      const { runScheduledImports } = await import("@/server/suppliers/price-lists");
      return runScheduledImports(prisma);
    },
  },
  {
    // Landed costs behind shop prices. Changes to offers and rules refresh their products at once; this catches the rest.
    name: "product-costs",
    cron: "20 * * * *",
    run: async () => {
      const { refreshCosts } = await import("@/server/shop/costs");
      return refreshCosts(prisma);
    },
  },
  {
    // Bank transfer orders not paid in time are cancelled, so their special units go back on sale.
    name: "unpaid-orders",
    cron: "*/15 * * * *",
    run: async () => {
      const { cancelUnpaid } = await import("@/server/shop/orders");
      return cancelUnpaid(prisma, { key: appKey() });
    },
  },
  {
    // Spent sign-in codes and ended sessions, a week on. Carts untouched for 60 days.
    name: "sign-in-cleanup",
    cron: "40 3 * * *",
    run: async () => {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      await prisma.emailCode.deleteMany({ where: { createdAt: { lt: weekAgo } } });
      await prisma.session.deleteMany({ where: { OR: [{ expiresAt: { lt: weekAgo } }, { revokedAt: { lt: weekAgo } }] } });
      await prisma.cart.deleteMany({ where: { updatedAt: { lt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) } } });
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
  // With jobs off (a test server), run it in the request instead.
  else await JOBS.find((j) => j.name === name && j.inline)?.run();
}
