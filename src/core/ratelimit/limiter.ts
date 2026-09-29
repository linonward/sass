import type { RateLimitConfig } from "@/core/config/schema";
import { logger, type LogFn } from "@/core/observability/logger";

/** Caller identity. Each policy counts per user and per IP separately; a missing one isn't counted. */
export type RateLimitIdentifiers = {
  userId?: string | null;
  ip?: string | null;
  /**
   * An extra counter key, used as-is (api-keys' per-key limits pass `api_key:<keyId>`). Same as
   * `userId` / `ip`: if omitted, this counter isn't used.
   */
  key?: string | null;
};

export type RateLimitResult =
  | { ok: true; retryAfter: 0 }
  // limited: over the threshold; retryAfter is the seconds until the window resets (at least 1).
  | { ok: false; reason: "limited"; retryAfter: number }
  // unavailable: Redis errored and failMode is closed.
  | { ok: false; reason: "unavailable"; retryAfter: number };

/** A single sliding-window counter: the fields we use from @upstash/ratelimit's `limit()` result. */
export type WindowLimiter = {
  limit(identifier: string): Promise<{
    success: boolean;
    // Timestamp when the window resets (milliseconds).
    reset: number;
    // On a request timeout, @upstash/ratelimit lets the request through and marks it as timeout.
    reason?: string;
  }>;
};

export type RateLimiterDeps = {
  config: RateLimitConfig;
  // Create a counter per policy; null means Redis isn't configured and rate limiting is skipped.
  createLimiter: (
    policy: string,
    options: RateLimitConfig["policies"][string],
  ) => WindowLimiter | null;
  /**
   * What to do when Redis isn't configured (`createLimiter` returns null):
   * - `"allow"` (default): let requests through, logging only once. Local development, tests, CI,
   *   and Vercel previews all take this path.
   * - `"unavailable"`: return 503 (for self-hosted production with Upstash missing; see
   *   `missingRedisPolicy` in `env.ts`) — silently turning off rate limiting is worse than the
   *   endpoint being temporarily unavailable: AI / upload cost money per call, and checkout
   *   really creates orders on the provider's side.
   */
  onMissingRedis?: "allow" | "unavailable";
  now?: () => number;
  warn?: LogFn;
  logError?: LogFn;
};

// How long to tell clients to wait before retrying when Redis is unavailable in closed mode.
const UNAVAILABLE_RETRY_AFTER = 30;

export class RateLimitRedisTimeout extends Error {
  constructor() {
    super("Upstash Redis request timed out");
  }
}

export function createRateLimiter({
  config,
  createLimiter,
  onMissingRedis = "allow",
  now = Date.now,
  warn = logger.warn,
  logError = logger.error,
}: RateLimiterDeps) {
  const limiters = new Map<string, WindowLimiter | null>();
  let warned = false;

  function getLimiter(policy: string) {
    if (!limiters.has(policy)) {
      const options = config.policies[policy];
      if (!options) throw new Error(`Unknown rate limit policy "${policy}"`);
      limiters.set(policy, createLimiter(policy, options));
    }
    return limiters.get(policy)!;
  }

  /**
   * Check one request against a policy: count once each for the user and the IP, and reject if
   * either is over the limit. Without Redis, allow or return unavailable per `onMissingRedis`
   * (logging only once); on Redis errors, follow `failMode`.
   */
  async function checkRateLimit(
    policy: string,
    identifiers: RateLimitIdentifiers,
  ): Promise<RateLimitResult> {
    const limiter = getLimiter(policy);
    if (!limiter) {
      if (!warned) {
        warned = true;
        const fields = {
          reason: "UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set",
        };
        // Missing config in production is an outage (endpoints start returning 503), so log at
        // error level; locally / in CI it's only a heads-up.
        if (onMissingRedis === "unavailable") {
          logError("ratelimit.unconfigured", fields);
        } else {
          warn("ratelimit.disabled", fields);
        }
      }
      return onMissingRedis === "unavailable"
        ? {
            ok: false,
            reason: "unavailable",
            retryAfter: UNAVAILABLE_RETRY_AFTER,
          }
        : { ok: true, retryAfter: 0 };
    }

    const keys = [
      identifiers.userId && `user:${identifiers.userId}`,
      identifiers.ip && `ip:${identifiers.ip}`,
      identifiers.key,
    ].filter((key): key is string => Boolean(key));

    try {
      const results = await Promise.all(
        keys.map(async (key) => {
          const result = await limiter.limit(key);
          if (result.reason === "timeout") throw new RateLimitRedisTimeout();
          return result;
        }),
      );
      const blocked = results.filter((result) => !result.success);
      if (blocked.length === 0) return { ok: true, retryAfter: 0 };
      const reset = Math.max(...blocked.map((result) => result.reset));
      return {
        ok: false,
        reason: "limited",
        retryAfter: Math.max(1, Math.ceil((reset - now()) / 1000)),
      };
    } catch (error) {
      logError("ratelimit.check_failed", { error, policy });
      return config.failMode === "closed"
        ? {
            ok: false,
            reason: "unavailable",
            retryAfter: UNAVAILABLE_RETRY_AFTER,
          }
        : { ok: true, retryAfter: 0 };
    }
  }

  return { checkRateLimit };
}

/**
 * Turn a rejected check result into an HTTP response: 429 when over the limit, 503 when Redis is
 * unavailable, both with `Retry-After` (seconds).
 * Usage: `if (!result.ok) return rateLimitResponse(result);`
 */
export function rateLimitResponse(
  result: Extract<RateLimitResult, { ok: false }>,
): Response {
  return Response.json(
    { error: result.reason === "limited" ? "rate_limited" : "unavailable" },
    {
      status: result.reason === "limited" ? 429 : 503,
      headers: { "Retry-After": String(result.retryAfter) },
    },
  );
}

/**
 * Get the client IP. Vercel overwrites `x-forwarded-for` (the first address is the real client),
 * so clients can't spoof it; when deploying elsewhere, make sure the proxy in front also
 * overwrites this header.
 */
export function getClientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || null;
}
