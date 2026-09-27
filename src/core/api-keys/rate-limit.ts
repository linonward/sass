import type { ApiKeysConfig, RateLimitConfig } from "@/core/config/schema";
import {
  createUpstashWindowLimiter,
  type RateLimitResult,
} from "@/core/ratelimit";
import { missingRedisPolicy } from "@/core/ratelimit/env";
import { rateLimitingEnabled } from "@/core/ratelimit/features";
import { createRateLimiter } from "@/core/ratelimit/limiter";

// 策略名只用在这里，不进 `site.config.ts` 的 `rateLimit.policies`（那套是按用户和 IP 计数的）。
const PER_KEY_POLICY = "apiKey";

/**
 * per-key 限流：每个 key 各占一个滑动窗口，计数键为 `api_key:<keyId>`。
 * 复用套件的 `createRateLimiter`，所以超时、failMode 和日志行为跟 AI / 上传一致。
 *
 * 没配 `apiKeys.rateLimitPerKey`（默认）时返回一个永远放行的检查函数。
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
    // 这里只借用滑动窗口的判定逻辑：策略名固定，阈值来自 apiKeys 配置。
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
