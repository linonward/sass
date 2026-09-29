import type { ApiKeysConfig, RateLimitConfig } from "@/core/config/schema";
import {
  createUpstashWindowLimiter,
  type RateLimitResult,
} from "@/core/ratelimit";
import { missingRedisPolicy } from "@/core/ratelimit/env";
import { rateLimitingEnabled } from "@/core/ratelimit/features";
import { createRateLimiter } from "@/core/ratelimit/limiter";

// The policy name is only used here and is not part of `rateLimit.policies` in `site.config.ts`
// (those count per user and per IP).
const PER_KEY_POLICY = "apiKey";

/**
 * Per-key rate limiting: each key gets its own sliding window, counted under `api_key:<keyId>`.
 * Reuses the kit's `createRateLimiter`, so timeouts, failMode, and logging behave the same as for
 * AI / uploads.
 *
 * Without `apiKeys.rateLimitPerKey` (the default), returns a check that always allows.
 */
export function createApiKeyRateLimiter({
  perKey,
  rateLimit,
  runtimeEnv = process.env,
}: {
  perKey: ApiKeysConfig["rateLimitPerKey"];
  rateLimit: RateLimitConfig;
  runtimeEnv?: Record<string, string | undefined>;
}): (keyId: string) => Promise<RateLimitResult | null> {
  if (!perKey) return async () => null;

  const { checkRateLimit } = createRateLimiter({
    // Only borrow the sliding-window logic here: the policy name is fixed and the thresholds come
    // from the apiKeys config.
    config: {
      failMode: rateLimit.failMode,
      policies: { [PER_KEY_POLICY]: perKey },
    },
    onMissingRedis: missingRedisPolicy(runtimeEnv, {
      enabled: rateLimitingEnabled(),
    }),
    createLimiter: (_policy, options) =>
      createUpstashWindowLimiter("ratelimit:api_key", options),
  });

  return async (keyId) => {
    const result = await checkRateLimit(PER_KEY_POLICY, {
      key: `api_key:${keyId}`,
    });
    return result.ok ? null : result;
  };
}
