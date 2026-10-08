import "server-only";
import Redis from "ioredis";
import { env } from "@/server/env";

const globalForRedis = globalThis as unknown as { redis?: Redis };

/**
 * One Redis connection per process, for rate limits and short-lived
 * caches. Nothing in Redis has to survive a restart: the database holds
 * everything that matters.
 */
export function redis(): Redis {
  globalForRedis.redis ??= new Redis(env().REDIS_URL, { maxRetriesPerRequest: 2, enableOfflineQueue: true, lazyConnect: false });
  return globalForRedis.redis;
}
