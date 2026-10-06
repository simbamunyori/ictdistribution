import type Redis from "ioredis";

/**
 * Fixed-window counters in Redis, shared by every copy of the app. One
 * atomic INCR per hit; the window starts with the first hit.
 */

export interface Limit {
  /** Most hits allowed in one window. */
  max: number;
  windowMs: number;
}

export const LIMITS = {
  /** Sign-in attempts (codes asked for, Microsoft, Google, passkeys) from one address. */
  signInPerIp: { max: 30, windowMs: 10 * 60_000 },
  /** Codes emailed to one address. */
  codePerEmail: { max: 5, windowMs: 15 * 60_000 },
  /** Code guesses from one address. */
  codeCheckPerIp: { max: 30, windowMs: 10 * 60_000 },
  /** New accounts from one address. */
  signUpPerIp: { max: 10, windowMs: 60 * 60_000 },
  /** Invitations sent by one organisation. */
  invitePerOrg: { max: 30, windowMs: 60 * 60_000 },
} satisfies Record<string, Limit>;

export class RateLimitedError extends Error {
  constructor(public readonly retryAt: Date) {
    super("Too many attempts. Try again shortly.");
    this.name = "RateLimitedError";
  }
}

const SCRIPT = `
local n = redis.call("INCR", KEYS[1])
if n == 1 then redis.call("PEXPIRE", KEYS[1], ARGV[1]) end
return { n, redis.call("PTTL", KEYS[1]) }`;

export async function hit(r: Pick<Redis, "eval">, key: string, limit: Limit, now = Date.now()): Promise<{ allowed: boolean; count: number; resetAt: Date }> {
  const [count, ttl] = (await r.eval(SCRIPT, 1, `rl:${key}`, String(limit.windowMs))) as [number, number];
  return { allowed: count <= limit.max, count, resetAt: new Date(now + Math.max(ttl, 0)) };
}

/** Throws RateLimitedError once the limit is passed. */
export async function enforce(r: Pick<Redis, "eval">, key: string, limit: Limit) {
  const result = await hit(r, key, limit);
  if (!result.allowed) throw new RateLimitedError(result.resetAt);
}
