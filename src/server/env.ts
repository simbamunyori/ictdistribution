import { z } from "zod";

/**
 * Settings that change between deployments come from the environment;
 * .env.example lists them all. Secrets are read through
 * src/server/secrets.ts instead, so a vault can take over later.
 */
/** Unset and empty both mean "not configured". */
const optionalText = () => z.string().optional().transform((v) => (v ? v : undefined));
const optionalUrl = () => z.union([z.literal(""), z.string().url()]).optional().transform((v) => (v ? v : undefined));

const schema = z.object({
  DATABASE_URL: z.string().url(),
  /** Rate limits and short-lived caches. */
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  /** The public address, used in email links and for passkeys. */
  APP_URL: z.string().url().default("http://localhost:3000"),
  /** The legal entity that trades, on invoices and the footer. Not decided yet (docs/ICTD_BUILD.md, decision 1). */
  COMPANY_LEGAL_NAME: z.string().min(1).default("ICT Distribution Africa"),
  /** Outgoing mail, e.g. smtps://user:pass@smtp.example.com:465, or smtp://localhost:1025 for Mailpit. */
  SMTP_URL: optionalUrl(),
  MAIL_FROM: z.string().min(3).default("ICT Distribution Africa <no-reply@localhost>"),
  /** Request header carrying the visitor's country, set by the CDN in front of the site. */
  GEO_COUNTRY_HEADER: z.string().min(1).default("cf-ipcountry"),
  /** Comma-separated IPs or IPv4 ranges (CIDR) allowed to open /admin. Empty allows any address. */
  ADMIN_IP_ALLOWLIST: z.string().default(""),
  /** Sign in with Microsoft: the app registration's id (docs/sign-in-setup.md). Its secret is MICROSOFT_CLIENT_SECRET. */
  MICROSOFT_CLIENT_ID: optionalText(),
  /** Our own Microsoft 365 tenant. Staff sign in with Microsoft only from it; unset hides staff Microsoft sign-in. */
  MICROSOFT_STAFF_TENANT_ID: optionalText(),
  /** Sign in with Google: the OAuth client's id. Its secret is GOOGLE_CLIENT_SECRET. */
  GOOGLE_CLIENT_ID: optionalText(),
  /** Where exchange rates come from: "open-er-api" (free, no key) or "off" to type them by hand. */
  RATE_SOURCE: z.enum(["open-er-api", "off"]).default("open-er-api"),
  /** The quotes mailbox: customers email requests here and suppliers reply here, e.g. quotes@ictdistribution.africa. */
  QUOTES_EMAIL: optionalText(),
  /** Reading that mailbox, e.g. imaps://quotes%40ictdistribution.africa:password@imap.example.com:993. Unset: email intake is off. */
  IMAP_URL: optionalUrl(),
  /** Set to "off" to stop background jobs on this server. */
  JOBS: z.enum(["on", "off"]).default("on"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
      throw new Error(`Missing or invalid environment variables:\n${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** For tests that change the environment. */
export function resetEnvCache() {
  cached = undefined;
}
