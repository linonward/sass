// 用真实的 @upstash/ratelimit，只替换 Redis 的 HTTP 请求，确认它在出错和超时时的行为和 limiter.ts 的假设一致。
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { afterEach, describe, expect, test, vi } from "vitest";

import { rateLimitConfigSchema } from "@/core/config/schema";

import { createRateLimiter } from "./limiter";

function setup(failMode: "open" | "closed") {
  const redis = new Redis({
    url: "https://example.upstash.io",
    token: "token",
    retry: false,
  });
  return createRateLimiter({
    config: rateLimitConfigSchema.parse({ failMode }),
    createLimiter: (policy, { limit }) =>
      new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(limit, "1 m"),
        prefix: `ratelimit:${policy}`,
        timeout: 50,
        ephemeralCache: false,
      }),
    logError: () => {},
  });
}

const failures = {
  连接失败: () => Promise.reject(new Error("ECONNREFUSED")),
  无响应: () => new Promise<Response>(() => {}),
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each(Object.entries(failures))("Redis %s", (_, fetch) => {
  test("closed 返回 unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(fetch));
    const { checkRateLimit } = setup("closed");
    expect(await checkRateLimit("ai", { userId: "u1" })).toMatchObject({
      ok: false,
      reason: "unavailable",
    });
  });

  test("open 放行", async () => {
    vi.stubGlobal("fetch", vi.fn(fetch));
    const { checkRateLimit } = setup("open");
    expect((await checkRateLimit("ai", { userId: "u1" })).ok).toBe(true);
  });
});
