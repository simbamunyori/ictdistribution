import { createHash, randomBytes } from "node:crypto";
import type { IdentityProvider, UserKind } from "@prisma/client";
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";

/**
 * Sign in with Microsoft (Entra ID) and Google: OpenID Connect with the
 * authorisation code flow, PKCE and a nonce. We only ever read the ID
 * token's identity; we ask for no access to mail, files or anything else.
 * Functions take their keys and fetch so they can be tested offline.
 */

/** Microsoft's tenant for personal accounts (outlook.com, hotmail.com). Their emails are always verified. */
export const MICROSOFT_CONSUMERS_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";

export interface ProviderSettings {
  provider: IdentityProvider;
  clientId: string;
  clientSecret: string;
  /** Staff only: our own Microsoft tenant. */
  tenantId?: string;
}

/** Who the account belongs to, as the provider vouches for it. */
export interface ProviderProfile {
  provider: IdentityProvider;
  /** Stable id: Microsoft "tenant:object id", Google "sub". */
  subject: string;
  email: string | null;
  /** Whether the provider vouches that the person owns the email. */
  emailVerified: boolean;
  name: string | null;
}

const MS = "https://login.microsoftonline.com";

function endpoints(s: ProviderSettings) {
  if (s.provider === "GOOGLE") {
    return { authorize: "https://accounts.google.com/o/oauth2/v2/auth", token: "https://oauth2.googleapis.com/token", jwks: "https://www.googleapis.com/oauth2/v3/certs" };
  }
  // Customers may use any work, school or personal account; staff only our tenant.
  const authority = s.tenantId ?? "common";
  return { authorize: `${MS}/${authority}/oauth2/v2.0/authorize`, token: `${MS}/${authority}/oauth2/v2.0/token`, jwks: `${MS}/${authority}/discovery/v2.0/keys` };
}

const b64url = (b: Buffer) => b.toString("base64url");

/** The random values one sign-in round trip carries: kept in a sealed cookie, never in the URL except the state. */
export interface FlowSecrets {
  state: string;
  nonce: string;
  verifier: string;
}

export function newFlowSecrets(): FlowSecrets {
  return { state: b64url(randomBytes(24)), nonce: b64url(randomBytes(24)), verifier: b64url(randomBytes(48)) };
}

export function authorizeUrl(s: ProviderSettings, f: FlowSecrets, redirectUri: string, o: { loginHint?: string } = {}): string {
  const u = new URL(endpoints(s).authorize);
  u.search = new URLSearchParams({
    client_id: s.clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: "openid email profile",
    state: f.state,
    nonce: f.nonce,
    code_challenge: b64url(createHash("sha256").update(f.verifier).digest()),
    code_challenge_method: "S256",
    // Always let people choose the account, so a shared computer doesn't sign in the wrong person.
    prompt: "select_account",
    ...(s.provider === "MICROSOFT" ? { response_mode: "query" } : {}),
    ...(o.loginHint ? { login_hint: o.loginHint } : {}),
  }).toString();
  return u.toString();
}

/** Swaps the returned code for the ID token. */
export async function exchangeCode(s: ProviderSettings, code: string, verifier: string, redirectUri: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(endpoints(s).token, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: s.clientId, client_secret: s.clientSecret, code_verifier: verifier }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string };
  if (!res.ok || !body.id_token) throw new OAuthError(`The ${s.provider === "GOOGLE" ? "Google" : "Microsoft"} sign-in didn't finish (${body.error ?? res.status}).`);
  return body.id_token;
}

export class OAuthError extends Error {}

const remoteKeys = new Map<string, JWTVerifyGetKey>();
function keysFor(s: ProviderSettings): JWTVerifyGetKey {
  const url = endpoints(s).jwks;
  let keys = remoteKeys.get(url);
  if (!keys) remoteKeys.set(url, (keys = createRemoteJWKSet(new URL(url))));
  return keys;
}

/**
 * Checks the ID token's signature, audience, expiry, nonce and issuer, and
 * reads who it is. A Microsoft work account's email counts as verified only
 * when Microsoft says the tenant owns the email's domain (the xms_edov claim);
 * staff sign in only from our tenant, whose addresses we manage.
 */
export async function verifyIdToken(s: ProviderSettings, idToken: string, nonce: string, keys: JWTVerifyGetKey = keysFor(s)): Promise<ProviderProfile> {
  let claims: JWTPayload & Record<string, unknown>;
  try {
    ({ payload: claims } = await jwtVerify(idToken, keys, { audience: s.clientId, clockTolerance: 60 }));
  } catch {
    throw new OAuthError("The sign-in couldn't be checked. Try again.");
  }
  if (claims.nonce !== nonce) throw new OAuthError("The sign-in couldn't be checked. Try again.");
  const str = (k: string) => (typeof claims[k] === "string" && claims[k] ? (claims[k] as string) : null);

  if (s.provider === "GOOGLE") {
    if (claims.iss !== "https://accounts.google.com" && claims.iss !== "accounts.google.com") throw new OAuthError("The sign-in came from an unexpected issuer.");
    if (!claims.sub) throw new OAuthError("The sign-in couldn't be checked. Try again.");
    const verified = claims.email_verified === true || claims.email_verified === "true";
    return { provider: "GOOGLE", subject: claims.sub, email: str("email")?.toLowerCase() ?? null, emailVerified: verified, name: str("name") };
  }

  const tid = str("tid");
  const oid = str("oid");
  // Multi-tenant tokens name their own tenant; the issuer must be that tenant's.
  if (!tid || !oid || claims.iss !== `${MS}/${tid}/v2.0`) throw new OAuthError("The sign-in came from an unexpected issuer.");
  if (s.tenantId && tid !== s.tenantId) throw new OAuthError("Staff sign in with their ICT Distribution Africa Microsoft account.");
  const email = (str("email") ?? (s.tenantId ? str("preferred_username") : null))?.toLowerCase() ?? null;
  const edov = claims.xms_edov === true || claims.xms_edov === 1 || claims.xms_edov === "1" || claims.xms_edov === "true";
  const verified = Boolean(email) && (tid === MICROSOFT_CONSUMERS_TENANT || edov || Boolean(s.tenantId));
  return { provider: "MICROSOFT", subject: `${tid}:${oid}`, email, emailVerified: verified, name: str("name") };
}

export const providerName = (p: IdentityProvider) => (p === "GOOGLE" ? "Google" : "Microsoft");
export const providerSlug = (p: IdentityProvider) => (p === "GOOGLE" ? "google" : "microsoft");
export const providerFromSlug = (slug: string): IdentityProvider | null => (slug === "google" ? "GOOGLE" : slug === "microsoft" ? "MICROSOFT" : null);

/** What a round trip is for. */
export type OAuthIntent = "sign-in" | "sign-up" | "link";
export interface OAuthFlow extends FlowSecrets {
  provider: IdentityProvider;
  audience: UserKind;
  intent: OAuthIntent;
  next: string;
  /** Epoch ms after which the round trip is refused. */
  expires: number;
}
