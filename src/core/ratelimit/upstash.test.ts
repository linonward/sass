// Uses the real @upstash/ratelimit and replaces only Redis's HTTP requests, to confirm that its
// behavior on errors and timeouts matches what limiter.ts assumes.
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
  "connection refused": () => Promise.reject(new Error("ECONNREFUSED")),
  "no response": () => new Promise<Response>(() => {}),
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each(Object.entries(failures))("Redis %s", (_, fetch) => {
  test("closed returns unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(fetch));
    const { checkRateLimit } = setup("closed");
    expect(await checkRateLimit("ai", { userId: "u1" })).toMatchObject({
      ok: false,
      reason: "unavailable",
    });
  });

  test("open lets requests through", async () => {
    vi.stubGlobal("fetch", vi.fn(fetch));
    const { checkRateLimit } = setup("open");
    expect((await checkRateLimit("ai", { userId: "u1" })).ok).toBe(true);
  });
});
