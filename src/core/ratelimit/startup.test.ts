// @vitest-environment node
// The startup check reads process.env and site.config.ts, so test it as a server module (same as
// env.test.ts).
import { describe, expect, test, vi } from "vitest";

import { warnIfRateLimitUnconfigured } from "./startup";

const upstash = {
  UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "token",
};

function run(runtimeEnv: Record<string, string | undefined>) {
  const log = { warn: vi.fn(), error: vi.fn() };
  warnIfRateLimitUnconfigured({ runtimeEnv, log });
  return log;
}

describe("warnIfRateLimitUnconfigured", () => {
  test("self-hosted production without Upstash: error-level log explaining the impact and the fix", () => {
    const log = run({ NODE_ENV: "production" });
    expect(log.error).toHaveBeenCalledOnce();
    expect(log.error.mock.calls[0]?.[0]).toBe("ratelimit.unconfigured");
    const fields = JSON.stringify(log.error.mock.calls[0]?.[1]);
    expect(fields).toContain("UPSTASH_REDIS_REST_URL");
    expect(fields).toContain("ALLOW_UNRATELIMITED"); // the log must mention the explicit opt-out
    expect(log.warn).not.toHaveBeenCalled();
  });

  test("logs nothing in local development, tests, and CI (no Upstash): requests go through, not an outage", () => {
    expect(run({ NODE_ENV: "development" }).error).not.toHaveBeenCalled();
    expect(run({ NODE_ENV: "test" }).error).not.toHaveBeenCalled();
    expect(run({ NODE_ENV: "development" }).warn).not.toHaveBeenCalled();
  });

  test("says nothing once Upstash is configured", () => {
    const log = run({ NODE_ENV: "production", ...upstash });
    expect(log.error).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  test("self-hosted production with ALLOW_UNRATELIMITED set: downgrades to a warn saying rate limiting is off", () => {
    const log = run({ NODE_ENV: "production", ALLOW_UNRATELIMITED: "1" });
    expect(log.error).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledOnce();
    expect(log.warn.mock.calls[0]?.[0]).toBe("ratelimit.disabled");
  });

  test("doesn't apply to Vercel previews (previews still skip rate limiting)", () => {
    const log = run({ VERCEL_ENV: "preview", NODE_ENV: "production" });
    expect(log.error).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });
});
