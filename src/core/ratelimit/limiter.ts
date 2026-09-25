import type { RateLimitConfig } from "@/core/config/schema";
import { logger, type LogFn } from "@/core/observability/logger";

/** 调用方身份。每条策略分别按用户和按 IP 计数；缺少的一项不计数。 */
export type RateLimitIdentifiers = {
  userId?: string | null;
  ip?: string | null;
};

export type RateLimitResult =
  | { ok: true; retryAfter: 0 }
  // limited：超过阈值，retryAfter 为距离窗口重置的秒数（至少 1）。
  | { ok: false; reason: "limited"; retryAfter: number }
  // unavailable：Redis 出错且 failMode 为 closed。
  | { ok: false; reason: "unavailable"; retryAfter: number };

/** 单个滑动窗口计数器，对应 @upstash/ratelimit 的 `limit()` 返回值中用到的字段。 */
export type WindowLimiter = {
  limit(identifier: string): Promise<{
    success: boolean;
    // 窗口重置的时间戳（毫秒）。
    reset: number;
    // 请求超时时 @upstash/ratelimit 会直接放行并标记为 timeout。
    reason?: string;
  }>;
};

export type RateLimiterDeps = {
  config: RateLimitConfig;
  // 按策略创建计数器；返回 null 表示没有配置 Redis，跳过限流。
  createLimiter: (
    policy: string,
    options: RateLimitConfig["policies"][string],
  ) => WindowLimiter | null;
  now?: () => number;
  warn?: LogFn;
  logError?: LogFn;
};

// closed 模式下 Redis 不可用时，建议客户端多久后重试。
const UNAVAILABLE_RETRY_AFTER = 30;

export class RateLimitRedisTimeout extends Error {
  constructor() {
    super("Upstash Redis request timed out");
  }
}

export function createRateLimiter({
  config,
  createLimiter,
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
   * 按策略检查一次请求：用户和 IP 各计一次，任一超限即拒绝。
   * 没有配置 Redis 时直接放行（只警告一次）；Redis 出错时按 `failMode` 处理。
   */
  async function checkRateLimit(
    policy: string,
    identifiers: RateLimitIdentifiers,
  ): Promise<RateLimitResult> {
    const limiter = getLimiter(policy);
    if (!limiter) {
      if (!warned) {
        warned = true;
        warn("ratelimit.disabled", {
          reason: "UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set",
        });
      }
      return { ok: true, retryAfter: 0 };
    }

    const keys = [
      identifiers.userId && `user:${identifiers.userId}`,
      identifiers.ip && `ip:${identifiers.ip}`,
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
 * 把被拒绝的检查结果转成 HTTP 响应：超限 429，Redis 不可用 503，都带 `Retry-After`（秒）。
 * 用法：`if (!result.ok) return rateLimitResponse(result);`
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
 * 取客户端 IP。Vercel 会覆盖 `x-forwarded-for`（首个地址为真实客户端），客户端伪造不了；
 * 部署到其他平台时，确认前面的代理同样会覆盖这个头。
 */
export function getClientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || null;
}
