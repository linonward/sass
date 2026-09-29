import { describe, expect, test, vi } from "vitest";

import { rateLimitConfigSchema } from "@/core/config/schema";

import {
  createRateLimiter,
  getClientIp,
  rateLimitResponse,
  type WindowLimiter,
} from "./limiter";

const NOW = 1_000_000;

/** An in-memory fixed-window counter standing in for @upstash/ratelimit on Redis. */
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
  onMissingRedis?: "allow" | "unavailable",
) {
  const warn = vi.fn();
  const logError = vi.fn();
  const createLimiter = vi.fn(() => limiter);
  const { checkRateLimit } = createRateLimiter({
    config: rateLimitConfigSchema.parse({ failMode }),
    createLimiter,
    onMissingRedis,
    now: () => NOW,
    warn,
    logError,
  });
  return { checkRateLimit, createLimiter, warn, logError };
}

const caller = { userId: "u1", ip: "1.2.3.4" };

describe("checkRateLimit", () => {
  test("allows requests within the threshold, then rejects with retryAfter", async () => {
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

  test("counts per user and per IP separately: switching IPs doesn't escape the user limit, and switching accounts doesn't escape the IP limit", async () => {
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

  test("counts by IP when only the IP is known", async () => {
    const limit = vi.fn(memoryLimiter(1).limit);
    const { checkRateLimit } = setup({ limit });
    await checkRateLimit("upload", { ip: "1.2.3.4" });
    expect(limit).toHaveBeenCalledExactlyOnceWith("ip:1.2.3.4");
  });

  test("creates one counter per policy and throws for undefined policies", async () => {
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

  test("skips rate limiting without Redis and warns only once", async () => {
    const { checkRateLimit, warn, logError } = setup(null);
    for (let i = 0; i < 3; i++) {
      expect((await checkRateLimit("ai", caller)).ok).toBe(true);
    }
    expect(warn).toHaveBeenCalledTimes(1);
    expect(logError).not.toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls[0])).toContain(
      "UPSTASH_REDIS_REST_URL",
    );
  });

  test("rejects requests when onMissingRedis is unavailable (self-hosted production misconfig), logging one error", async () => {
    const { checkRateLimit, warn, logError } = setup(
      null,
      "open",
      "unavailable",
    );
    for (let i = 0; i < 3; i++) {
      expect(await checkRateLimit("ai", caller)).toEqual({
        ok: false,
        reason: "unavailable",
        retryAfter: 30,
      });
    }
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledExactlyOnceWith("ratelimit.unconfigured", {
      reason: "UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set",
    });
    // The warn for the let-through case must not be logged as well.
    expect(warn).not.toHaveBeenCalled();
  });

  test("onMissingRedis has no effect when Redis is configured", async () => {
    const { checkRateLimit } = setup(memoryLimiter(1), "open", "unavailable");
    expect((await checkRateLimit("ai", caller)).ok).toBe(true);
  });

  const failing: Record<string, WindowLimiter> = {
    errors: { limit: () => Promise.reject(new Error("ECONNREFUSED")) },
    "times out": {
      limit: async () => ({ success: true, reset: 0, reason: "timeout" }),
    },
  };

  test.each(Object.entries(failing))(
    "when Redis %s, open lets requests through and logs the error",
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
    "when Redis %s, closed rejects and marks unavailable",
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
  test("returns 429 with Retry-After when over the limit", async () => {
    const response = rateLimitResponse({
      ok: false,
      reason: "limited",
      retryAfter: 12,
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("12");
    expect(await response.json()).toEqual({ error: "rate_limited" });
  });

  test("returns 503 when Redis is unavailable", async () => {
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
  test("takes the first x-forwarded-for address, falling back to x-real-ip", () => {
    expect(
      getClientIp(new Headers({ "x-forwarded-for": "1.1.1.1, 10.0.0.1" })),
    ).toBe("1.1.1.1");
    expect(getClientIp(new Headers({ "x-real-ip": "2.2.2.2" }))).toBe(
      "2.2.2.2",
    );
    expect(getClientIp(new Headers())).toBeNull();
  });
});
