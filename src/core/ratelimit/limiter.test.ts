import { describe, expect, test, vi } from "vitest";

import { rateLimitConfigSchema } from "@/core/config/schema";

import {
  createRateLimiter,
  getClientIp,
  rateLimitResponse,
  type WindowLimiter,
} from "./limiter";

const NOW = 1_000_000;

/** 内存里的固定窗口计数器，模拟 Redis 上的 @upstash/ratelimit。 */
function memoryLimiter(limit: number, windowMs = 60_000): WindowLimiter {
  const counts = new Map<string, number>();
  return {
    limit: async (key) => {
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return { success: count <= limit, reset: NOW + windowMs };
    },
  };
}

function setup(
  limiter: WindowLimiter | null,
  failMode: "open" | "closed" = "open",
) {
  const warn = vi.fn();
  const logError = vi.fn();
  const createLimiter = vi.fn(() => limiter);
  const { checkRateLimit } = createRateLimiter({
    config: rateLimitConfigSchema.parse({ failMode }),
    createLimiter,
    now: () => NOW,
    warn,
    logError,
  });
  return { checkRateLimit, createLimiter, warn, logError };
}

const caller = { userId: "u1", ip: "1.2.3.4" };

describe("checkRateLimit", () => {
  test("阈值内放行，超过后拒绝并给出 retryAfter", async () => {
    const { checkRateLimit } = setup(memoryLimiter(2, 30_000));
    expect(await checkRateLimit("ai", caller)).toEqual({
      ok: true,
      retryAfter: 0,
    });
    expect((await checkRateLimit("ai", caller)).ok).toBe(true);
    expect(await checkRateLimit("ai", caller)).toEqual({
      ok: false,
      reason: "limited",
      retryAfter: 30,
    });
  });

  test("按用户和按 IP 分别计数：换 IP 也躲不开用户的限额，换账号也躲不开 IP 的限额", async () => {
    const { checkRateLimit } = setup(memoryLimiter(1));
    expect((await checkRateLimit("ai", caller)).ok).toBe(true);
    expect(
      (await checkRateLimit("ai", { userId: "u1", ip: "5.6.7.8" })).ok,
    ).toBe(false);
    expect(
      (await checkRateLimit("ai", { userId: "u2", ip: "1.2.3.4" })).ok,
    ).toBe(false);
    expect(
      (await checkRateLimit("ai", { userId: "u3", ip: "9.9.9.9" })).ok,
    ).toBe(true);
  });

  test("只有 IP 时按 IP 计数", async () => {
    const limit = vi.fn(memoryLimiter(1).limit);
    const { checkRateLimit } = setup({ limit });
    await checkRateLimit("upload", { ip: "1.2.3.4" });
    expect(limit).toHaveBeenCalledExactlyOnceWith("ip:1.2.3.4");
  });

  test("每条策略只创建一次计数器，未定义的策略直接报错", async () => {
    const { checkRateLimit, createLimiter } = setup(memoryLimiter(10));
    await checkRateLimit("ai", caller);
    await checkRateLimit("ai", caller);
    await checkRateLimit("upload", caller);
    expect(createLimiter).toHaveBeenCalledTimes(2);
    expect(createLimiter).toHaveBeenCalledWith("ai", {
      limit: 20,
      window: "1 m",
    });
    await expect(checkRateLimit("nope", caller)).rejects.toThrow(
      'Unknown rate limit policy "nope"',
    );
  });

  test("没有配置 Redis 时跳过限流，只警告一次", async () => {
    const { checkRateLimit, warn } = setup(null);
    for (let i = 0; i < 3; i++) {
      expect((await checkRateLimit("ai", caller)).ok).toBe(true);
    }
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("UPSTASH_REDIS_REST_URL");
  });

  const failing: Record<string, WindowLimiter> = {
    报错: { limit: () => Promise.reject(new Error("ECONNREFUSED")) },
    超时: {
      limit: async () => ({ success: true, reset: 0, reason: "timeout" }),
    },
  };

  test.each(Object.entries(failing))(
    "Redis %s时，open 放行并记录错误",
    async (_, limiter) => {
      const { checkRateLimit, logError } = setup(limiter, "open");
      expect(await checkRateLimit("ai", caller)).toEqual({
        ok: true,
        retryAfter: 0,
      });
      expect(logError).toHaveBeenCalledOnce();
    },
  );

  test.each(Object.entries(failing))(
    "Redis %s时，closed 拒绝并标记 unavailable",
    async (_, limiter) => {
      const { checkRateLimit, logError } = setup(limiter, "closed");
      expect(await checkRateLimit("ai", caller)).toEqual({
        ok: false,
        reason: "unavailable",
        retryAfter: 30,
      });
      expect(logError).toHaveBeenCalledOnce();
    },
  );
});

describe("rateLimitResponse", () => {
  test("超限返回 429 和 Retry-After", async () => {
    const response = rateLimitResponse({
      ok: false,
      reason: "limited",
      retryAfter: 12,
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("12");
    expect(await response.json()).toEqual({ error: "rate_limited" });
  });

  test("Redis 不可用返回 503", async () => {
    const response = rateLimitResponse({
      ok: false,
      reason: "unavailable",
      retryAfter: 30,
    });
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("30");
  });
});

describe("getClientIp", () => {
  test("取 x-forwarded-for 的第一个地址，没有时用 x-real-ip", () => {
    expect(
      getClientIp(new Headers({ "x-forwarded-for": "1.1.1.1, 10.0.0.1" })),
    ).toBe("1.1.1.1");
    expect(getClientIp(new Headers({ "x-real-ip": "2.2.2.2" }))).toBe(
      "2.2.2.2",
    );
    expect(getClientIp(new Headers())).toBeNull();
  });
});
