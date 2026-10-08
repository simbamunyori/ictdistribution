import type { CustomerTypeCode, IdentityProvider, PrismaClient } from "@prisma/client";
import { isCountryCode } from "@/lib/countries";
import { marketForCountry } from "@/lib/markets";
import { audit } from "@/server/audit";
import { AuthError, clock, EMAIL_PATTERN, normaliseEmail, startSession, type AuthDeps, type RequestContext } from "@/server/auth/service";
import { ORGANISATION_TYPES } from "@/server/pricing/customer-types";

/**
 * A new customer, after their email is proven (by a code, or by Microsoft
 * or Google vouching for it). They buy as themselves (Individual), or set
 * up their organisation as a Business, Reseller or Government buyer and
 * become its Owner. Trade prices wait for staff to verify the business
 * (D4); until then an organisation sees what an individual sees.
 */

export interface SignUpInput {
  /** Proven before this is called. */
  email: string;
  name: string;
  /** ISO 3166-1 alpha-2: where they buy from. */
  country: string;
  organisation?: { name: string; type: CustomerTypeCode; registrationNumber?: string; taxNumber?: string };
  /** A Microsoft or Google account to link, when that is how they arrived. */
  identity?: { provider: IdentityProvider; subject: string; email: string };
}

export async function signUp(deps: AuthDeps, input: SignUpInput, ctx: RequestContext = {}): Promise<{ token: string; userId: string; organisationId: string | null }> {
  const now = clock(deps);
  const email = normaliseEmail(input.email);
  const name = input.name.trim().replace(/\s+/g, " ");
  const country = input.country.trim().toUpperCase();
  const fieldErrors: Record<string, string> = {};
  if (!EMAIL_PATTERN.test(email)) throw new AuthError("invalid-input", "Start again with a valid email address.");
  if (name.length < 2 || name.length > 100) fieldErrors.name = "Enter your full name.";
  if (!isCountryCode(country)) fieldErrors.country = "Choose your country.";
  const org = input.organisation && {
    name: input.organisation.name.trim().replace(/\s+/g, " "),
    type: input.organisation.type,
    registrationNumber: input.organisation.registrationNumber?.trim() || null,
    taxNumber: input.organisation.taxNumber?.trim() || null,
  };
  if (org) {
    if (org.name.length < 2 || org.name.length > 120) fieldErrors.organisation = "Enter the organisation's name.";
    if (!ORGANISATION_TYPES.includes(org.type)) fieldErrors.organisationType = "Choose what kind of organisation it is.";
  }
  if (Object.keys(fieldErrors).length) throw new SignUpError(fieldErrors);

  const markets = await deps.db.market.findMany();
  const market = marketForCountry(country, markets);
  if (!market) throw new SignUpError({ country: "We don't sell in that country yet. Choose one of ours, or contact us." });

  return deps.db.$transaction(async (tx) => {
    if (await tx.user.findUnique({ where: { email } })) throw new AuthError("forbidden", "There is already an account for this email. Sign in instead.");
    const user = await tx.user.create({ data: { email, name, emailVerifiedAt: now, marketCode: market.code } });
    if (input.identity) {
      await tx.externalIdentity.create({ data: { userId: user.id, provider: input.identity.provider, subject: input.identity.subject, email: input.identity.email, lastUsedAt: now } });
    }
    await audit(tx, { actorKind: "CUSTOMER", actorUserId: user.id, actorLabel: name, subjectUserId: user.id, action: "account.created", summary: "Opened an account", visibleToCustomer: true, ipAddress: ctx.ipAddress });
    let organisationId: string | null = null;
    if (org) {
      const created = await tx.organisation.create({
        data: { name: org.name, customerType: org.type, country, marketCode: market.code, registrationNumber: org.registrationNumber, taxNumber: org.taxNumber },
      });
      organisationId = created.id;
      await tx.membership.create({ data: { organisationId, userId: user.id, role: "OWNER" } });
      await audit(tx, {
        actorKind: "CUSTOMER",
        actorUserId: user.id,
        actorLabel: name,
        organisationId,
        action: "organisation.created",
        summary: `Set up ${org.name} and became its Owner`,
        visibleToCustomer: true,
        ipAddress: ctx.ipAddress,
      });
    }
    const { token } = await startSession(tx, user, ctx, now);
    return { token, userId: user.id, organisationId };
  });
}

export class SignUpError extends Error {
  constructor(public readonly fieldErrors: Record<string, string>) {
    super("Check the highlighted fields.");
    this.name = "SignUpError";
  }
}

/** Whether an email already has an account, for the sign-up page. */
export async function accountExists(db: Pick<PrismaClient, "user">, email: string) {
  return Boolean(await db.user.findUnique({ where: { email: normaliseEmail(email) }, select: { id: true } }));
}
