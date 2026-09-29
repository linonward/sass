// @vitest-environment node
// t3-env only validates server variables on the server; under jsdom it would count as the client.
import { describe, expect, test } from "vitest";

import { createAppEnv } from "../create-env";
import {
  missingRedisPolicy,
  rateLimitServerEnv,
  upstashConfigured,
} from "./env";

function check(runtimeEnv: Record<string, string | undefined>, enabled = true) {
  return () =>
    createAppEnv({
      server: rateLimitServerEnv(runtimeEnv, { enabled }),
      runtimeEnv,
    });
}

const upstash = {
  UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "token",
};

describe("rateLimitServerEnv", () => {
  test("fails in Vercel production with ai / upload / rateLimit enabled when the Upstash variables are missing", () => {
    expect(check({ VERCEL_ENV: "production" })).toThrow(
      "- UPSTASH_REDIS_REST_URL: ",
    );
    expect(check({ VERCEL_ENV: "production" })).toThrow(
      "- UPSTASH_REDIS_REST_TOKEN: ",
    );
    expect(check({ VERCEL_ENV: "production", ...upstash })).not.toThrow();
  });

  test("doesn't require them in production when none of the related modules are on", () => {
    expect(check({ VERCEL_ENV: "production" }, false)).not.toThrow();
  });

  test("doesn't require them locally, in CI, or in previews", () => {
    expect(check({})).not.toThrow();
    expect(check({ VERCEL_ENV: "preview" })).not.toThrow();
  });

  test("the REST URL must be https", () => {
    expect(
      check({ ...upstash, UPSTASH_REDIS_REST_URL: "redis://example:6379" }),
    ).toThrow("- UPSTASH_REDIS_REST_URL: ");
  });

  test("ALLOW_UNRATELIMITED only accepts 1 / true / 0 / false", () => {
    expect(check({ ALLOW_UNRATELIMITED: "true" })).not.toThrow();
    expect(check({ ALLOW_UNRATELIMITED: "yes" })).toThrow(
      "- ALLOW_UNRATELIMITED: ",
    );
  });
});

describe("upstashConfigured", () => {
  test("both variables are required; one missing or an empty string counts as unset", () => {
    expect(upstashConfigured(upstash)).toBe(true);
    expect(
      upstashConfigured({ ...upstash, UPSTASH_REDIS_REST_TOKEN: "" }),
    ).toBe(false);
    expect(
      upstashConfigured({
        UPSTASH_REDIS_REST_URL: upstash.UPSTASH_REDIS_REST_URL,
      }),
    ).toBe(false);
    expect(upstashConfigured({})).toBe(false);
  });
});

describe("missingRedisPolicy", () => {
  const enabled = { enabled: true };

  test("rejects requests in self-hosted production (NODE_ENV=production, not on Vercel) when unconfigured", () => {
    expect(missingRedisPolicy({ NODE_ENV: "production" }, enabled)).toBe(
      "unavailable",
    );
  });

  test("lets requests through in local development, tests, and CI", () => {
    expect(missingRedisPolicy({ NODE_ENV: "development" }, enabled)).toBe(
      "allow",
    );
    expect(missingRedisPolicy({ NODE_ENV: "test" }, enabled)).toBe("allow");
    // An unset NODE_ENV (scenarios other than local `pnpm dev`) is not treated as production.
    expect(missingRedisPolicy({}, enabled)).toBe("allow");
  });

  test("Vercel previews let requests through; Vercel production rejects (env validation catches it first)", () => {
    expect(
      missingRedisPolicy(
        { VERCEL_ENV: "preview", NODE_ENV: "production" },
        enabled,
      ),
    ).toBe("allow");
    expect(
      missingRedisPolicy(
        { VERCEL_ENV: "production", NODE_ENV: "production" },
        enabled,
      ),
    ).toBe("unavailable");
  });

  test("ALLOW_UNRATELIMITED=1 / true explicitly lets requests through; 0 or unset still rejects", () => {
    expect(
      missingRedisPolicy(
        { NODE_ENV: "production", ALLOW_UNRATELIMITED: "1" },
        enabled,
      ),
    ).toBe("allow");
    expect(
      missingRedisPolicy(
        { NODE_ENV: "production", ALLOW_UNRATELIMITED: "true" },
        enabled,
      ),
    ).toBe("allow");
    expect(
      missingRedisPolicy(
        { NODE_ENV: "production", ALLOW_UNRATELIMITED: "0" },
        enabled,
      ),
    ).toBe("unavailable");
  });

  test("doesn't apply when none of the rate-limited modules are on", () => {
    expect(
      missingRedisPolicy({ NODE_ENV: "production" }, { enabled: false }),
    ).toBe("allow");
  });
});
