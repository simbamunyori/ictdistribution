/**
 * Server commands, bundled into the production image as /app/ops.cjs.
 * On the server, run them through deploy/ictd:
 *
 *   ictd create-admin "Full Name" you@ictdistribution.africa
 *       invites a staff Admin: emails them the link and prints it here too.
 *       They open it and add a passkey. Nobody has a password.
 *
 *   node ops.cjs prestart
 *       run by deploy/deploy.sh before each release starts: adds the
 *       reference data a new database needs (currencies, markets, customer
 *       types), fetches the first exchange rates, then lists anything that
 *       would stop a production start.
 *
 * Locally: npm run ops -- create-admin "Your Name" you@example.com
 */
import { PrismaClient } from "@prisma/client";
import { DomainError } from "@/server/errors";
import { findPlaceholders } from "@/server/placeholders";
import { OpenErApiSource, refreshRates } from "@/server/pricing/rates";
import { seedReferenceData } from "@/server/seed";
import { inviteStaff } from "@/server/staff/staff";

const db = new PrismaClient();

/** The app key, read the way src/server/secrets.ts does (that module only loads inside the app). */
function appKey(): string {
  const key = process.env.APP_SECRET ?? "";
  if (Buffer.from(key, "base64").length !== 32) throw new Error("APP_SECRET must be set to 32 random bytes, base64 encoded.");
  return key;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const e = process.env;

  if (command === "prestart") {
    const added = await seedReferenceData(db);
    if (added.length) console.log(`Added: ${added.join("; ")}.`);
    if ((await db.exchangeRate.count()) === 0 && e.RATE_SOURCE !== "off") {
      try {
        const r = await refreshRates(db, new OpenErApiSource());
        console.log(`Fetched the first exchange rates: ${r.stored.join(", ") || "none needed"}.`);
      } catch (err) {
        console.warn(`Couldn't fetch exchange rates yet (${err instanceof Error ? err.message : err}). The app tries again every six hours; staff can set them at /admin/exchange-rates.`);
      }
    }
    const found = await findPlaceholders(db, { APP_URL: e.APP_URL ?? "http://localhost:3000", MAIL_FROM: e.MAIL_FROM ?? "no-reply@localhost", SMTP_URL: e.SMTP_URL || null, NODE_ENV: "production" });
    if (found.length && e.ALLOW_PLACEHOLDERS !== "yes") {
      console.error(`The app will refuse to start until these are fixed (on the server, most are lines in /opt/ictd/.env, see docs/deploy.md):\n${found.map((f) => `  - ${f}`).join("\n")}`);
      process.exitCode = 1;
    }
    return;
  }

  if (command === "create-admin") {
    const [name, email] = args;
    if (!name || !email) throw new Error('Usage: ictd create-admin "Full Name" you@ictdistribution.africa');
    const { token } = await inviteStaff({ db, key: appKey() }, null, { name, email, role: "ADMIN" });
    const url = `${(e.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/admin/invite/${token}`;
    console.log(`Invited ${name} (${email.trim().toLowerCase()}) as a staff Admin. The email is on its way; the link works for 3 days:\n\n  ${url}\n\nOpen it on the phone or computer you'll use for work and add a passkey.`);
    return;
  }

  throw new Error("Commands: prestart, create-admin");
}

main()
  .catch((err) => {
    if (err instanceof DomainError && err.fieldErrors) console.error(Object.values(err.fieldErrors).join("\n"));
    else console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
