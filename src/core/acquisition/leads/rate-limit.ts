import { createHmac } from "node:crypto";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { env } from "@/core/env";
import {
  createRateLimiter,
  type RateLimitResult,
} from "@/core/ratelimit/limiter";

export function createLeadLimit(
  check: (policy: string, key: string) => Promise<RateLimitResult>,
  secret: string,
) {
  return async (email: string, ip: string | null): Promise<RateLimitResult> => {
    if (!ip) return { ok: false, reason: "unavailable", retryAfter: 30 };
    // Do not send raw email or IP to Redis or put them in logs.
    const hash = (value: string) =>
      createHmac("sha256", secret).update(`lead-limit:${value}`).digest("hex");
    const results = await Promise.all([
      check("lead-ip", hash(ip)),
      check("lead-email", hash(email)),
    ]);
    return results.find((result) => !result.ok) ?? { ok: true, retryAfter: 0 };
  };
}
const limiter = createRateLimiter({
  config: {
    failMode: "closed",
    policies: {
      "lead-action": { limit: 30, window: "1 h" },
      "lead-ip": { limit: 10, window: "1 h" },
      "lead-email": { limit: 3, window: "1 h" },
    },
  },
  createLimiter: (policy, { limit }) => {
    if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN)
      return {
        limit: async () => {
          throw new Error("Lead rate limiter unavailable");
        },
      };
    return new Ratelimit({
      redis: new Redis({
        url: env.UPSTASH_REDIS_REST_URL,
        token: env.UPSTASH_REDIS_REST_TOKEN,
      }),
      limiter: Ratelimit.slidingWindow(limit, "1 h"),
      prefix: `ratelimit:${policy}`,
      timeout: 1000,
    });
  },
});
export const checkLeadLimit = createLeadLimit(
  (policy, key) => limiter.checkRateLimit(policy, { userId: key }),
  env.BETTER_AUTH_SECRET,
);

export async function checkLeadActionLimit(
  ip: string | null,
): Promise<RateLimitResult> {
  if (!ip) return { ok: false, reason: "unavailable", retryAfter: 30 };
  const key = createHmac("sha256", env.BETTER_AUTH_SECRET)
    .update(`lead-action:${ip}`)
    .digest("hex");
  return limiter.checkRateLimit("lead-action", { userId: key });
}
