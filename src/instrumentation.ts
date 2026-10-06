/**
 * Runs once when the server starts (not during the build): refuses to
 * start in production while development values are still set, then
 * starts background jobs.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const [{ prisma }, { env }, { assertNoPlaceholders }] = await Promise.all([import("@/server/db"), import("@/server/env"), import("@/server/placeholders")]);
    try {
      await assertNoPlaceholders(prisma, { ...env(), SMTP_URL: env().SMTP_URL ?? null });
    } catch (e) {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    }
    const { startJobs } = await import("@/server/jobs/boss");
    await startJobs();
  }
}
