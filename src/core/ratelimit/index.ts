import { Ratelimit, type Duration } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

import { env } from "@/core/env";

import siteConfig from "../../../site.config";
import { missingRedisPolicy } from "./env";
import { rateLimitingEnabled } from "./features";
import { createRateLimiter, type WindowLimiter } from "./limiter";

export {
  getClientIp,
  rateLimitResponse,
  type RateLimitIdentifiers,
  type RateLimitResult,
  type WindowLimiter,
} from "./limiter";

// Upper bound on waiting for Redis. A timeout is handled per failMode so rate limiting never slows
// down the endpoint.
const REDIS_TIMEOUT_MS = 1000;

let redis: Redis | null | undefined;

function getRedis() {
  if (redis === undefined) {
    const url = env.UPSTASH_REDIS_REST_URL;
    const token = env.UPSTASH_REDIS_REST_TOKEN;
    redis = url && token ? new Redis({ url, token }) : null;
  }
  return redis;
}

/**
 * Create a sliding-window counter. Returns null when Redis isn't configured and lets the caller
 * decide (`createRateLimiter` uses `onMissingRedis`; api-keys' per-key limits let requests
 * through). The Redis client is created only once here and shared by the core policies and
 * api-keys.
 */
export function createUpstashWindowLimiter(
  prefix: string,
  { limit, window }: { limit: number; window: string },
): WindowLimiter | null {
  const client = getRedis();
  if (!client) return null;
  return new Ratelimit({
    redis: client,
    // The caller's schema has already validated the Duration format.
    limiter: Ratelimit.slidingWindow(limit, window as Duration),
    prefix,
    timeout: REDIS_TIMEOUT_MS,
  });
}

/** The rate limit check, bound to Upstash Redis and the `rateLimit` config in `site.config.ts`. */
export const { checkRateLimit } = createRateLimiter({
  config: siteConfig.rateLimit,
  // Self-hosted production (`NODE_ENV=production` and not on Vercel) with Redis missing rejects
  // requests instead of silently not rate limiting: such deployments have no platform-side
  // variable validation, and the only signal would otherwise be a single warn log line.
  onMissingRedis: missingRedisPolicy(process.env, {
    enabled: rateLimitingEnabled(),
  }),
  createLimiter: (policy, options) =>
    createUpstashWindowLimiter(`ratelimit:${policy}`, options),
});
