import type { IdentityProvider, UserKind } from "@prisma/client";
import { company } from "@/config/app";
import { env } from "@/server/env";
import { secret } from "@/server/secrets";
import type { ProviderSettings } from "./oauth";
import { relyingParty, type RelyingParty } from "./passkeys";

/**
 * Which ways in are switched on (docs/sign-in-setup.md). Microsoft and
 * Google need both their id and secret; while either is missing their
 * buttons hide. Staff use Microsoft only from our own tenant, never Google.
 */

export function providerSettings(provider: IdentityProvider, audience: UserKind): ProviderSettings | null {
  const e = env();
  if (provider === "GOOGLE") {
    const clientSecret = secret("GOOGLE_CLIENT_SECRET");
    return audience === "CUSTOMER" && e.GOOGLE_CLIENT_ID && clientSecret ? { provider, clientId: e.GOOGLE_CLIENT_ID, clientSecret } : null;
  }
  const clientSecret = secret("MICROSOFT_CLIENT_SECRET");
  if (!e.MICROSOFT_CLIENT_ID || !clientSecret) return null;
  if (audience === "STAFF") return e.MICROSOFT_STAFF_TENANT_ID ? { provider, clientId: e.MICROSOFT_CLIENT_ID, clientSecret, tenantId: e.MICROSOFT_STAFF_TENANT_ID } : null;
  return { provider, clientId: e.MICROSOFT_CLIENT_ID, clientSecret };
}

/** The providers to offer, in the order their buttons show. */
export function enabledProviders(audience: UserKind): IdentityProvider[] {
  return (["MICROSOFT", "GOOGLE"] as const).filter((p) => providerSettings(p, audience));
}

/** Where the provider sends people back to. Staff come back under /admin, so the address allowlist applies. */
export function callbackUrl(provider: IdentityProvider, audience: UserKind): string {
  const slug = provider === "GOOGLE" ? "google" : "microsoft";
  return new URL(`${audience === "STAFF" ? "/admin" : ""}/auth/${slug}/callback`, env().APP_URL).toString();
}

export function siteRelyingParty(): RelyingParty {
  return relyingParty(env().APP_URL, company.name);
}
