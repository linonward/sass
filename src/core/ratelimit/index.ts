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

/**
 * 建一个滑动窗口计数器。Redis 没配时返回 null，由调用方决定怎么处理
 * （`createRateLimiter` 走 `onMissingRedis`，api-keys 的 per-key 限流直接放行）。
 * Redis 客户端在这里只建一次，套件策略和 api-keys 共用。
 */
export function createUpstashWindowLimiter(
  prefix: string,
  { limit, window }: { limit: number; window: string },
): WindowLimiter | null {
  const client = getRedis();
  if (!client) return null;
  return new Ratelimit({
    redis: client,
    // 调用方的 schema 已按 Duration 的格式校验过。
    limiter: Ratelimit.slidingWindow(limit, window as Duration),
    prefix,
    timeout: REDIS_TIMEOUT_MS,
  });
}

/** 绑定 Upstash Redis 和 `site.config.ts` 中 `rateLimit` 配置的限流检查。 */
export const { checkRateLimit } = createRateLimiter({
  config: siteConfig.rateLimit,
  // 自托管生产（`NODE_ENV=production` 且不在 Vercel 上）漏配 Redis 时拒绝请求，而不是静默
  // 不限流：这类部署没有平台侧的变量校验，唯一的信号原本只有一行 warn 日志。
  onMissingRedis: missingRedisPolicy(process.env, {
    enabled: rateLimitingEnabled(),
  }),
  createLimiter: (policy, options) =>
    createUpstashWindowLimiter(`ratelimit:${policy}`, options),
});
