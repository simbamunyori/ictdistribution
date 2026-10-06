import "server-only";

/**
 * Every secret the platform holds. They are read here and nowhere else,
 * never logged and never sent to the browser.
 *
 * Today they come from environment variables. To move to a vault, add a
 * SecretSource that reads from it and pass it to useSecretSource() at
 * start-up; nothing else changes.
 */

export type SecretName =
  /** 32 random bytes, base64: seals short-lived cookies and email codes. */
  | "APP_SECRET"
  | "MICROSOFT_CLIENT_SECRET"
  | "GOOGLE_CLIENT_SECRET";

export interface SecretSource {
  get(name: SecretName): string | undefined;
}

const envSource: SecretSource = {
  get: (name) => {
    const v = process.env[name];
    return v === "" ? undefined : v;
  },
};

let source: SecretSource = envSource;

export function useSecretSource(next: SecretSource) {
  source = next;
}

export function secret(name: SecretName): string | undefined {
  return source.get(name);
}

export function requireSecret(name: SecretName): string {
  const v = source.get(name);
  if (!v) throw new Error(`${name} is not set.`);
  return v;
}

/** The key that seals cookies and email codes: exactly 32 random bytes, base64. */
export function appKey(): string {
  const key = requireSecret("APP_SECRET");
  if (Buffer.from(key, "base64").length !== 32) throw new Error("APP_SECRET must be 32 random bytes, base64 encoded.");
  return key;
}
