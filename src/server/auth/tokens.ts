import { createHash, randomBytes } from "node:crypto";

/** 256 random bits, safe in a URL. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Tokens are stored only as their SHA-256 hash. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
