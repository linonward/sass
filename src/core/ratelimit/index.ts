import { Ratelimit, type Duration } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

import { env } from "@/core/env";

import siteConfig from "../../../site.config";
import { createRateLimiter } from "./limiter";

export {
  getClientIp,
  rateLimitResponse,
  type RateLimitIdentifiers,
  type RateLimitResult,
} from "./limiter";

// 等待 Redis 的上限。超时按 failMode 处理，不让限流拖慢接口。
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

/** 绑定 Upstash Redis 和 `site.config.ts` 中 `rateLimit` 配置的限流检查。 */
export const { checkRateLimit } = createRateLimiter({
  config: siteConfig.rateLimit,
  createLimiter: (policy, { limit, window }) => {
    const client = getRedis();
    if (!client) return null;
    return new Ratelimit({
      redis: client,
      // schema 已按 Duration 的格式校验过。
      limiter: Ratelimit.slidingWindow(limit, window as Duration),
      prefix: `ratelimit:${policy}`,
      timeout: REDIS_TIMEOUT_MS,
    });
  },
});
