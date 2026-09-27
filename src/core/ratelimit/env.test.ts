// @vitest-environment node
// t3-env 只在服务端校验 server 变量，jsdom 下会被当成客户端。
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
  test("Vercel 生产环境开启了 ai / upload / rateLimit 时，缺少 Upstash 变量会报错", () => {
    expect(check({ VERCEL_ENV: "production" })).toThrow(
      "- UPSTASH_REDIS_REST_URL: ",
    );
    expect(check({ VERCEL_ENV: "production" })).toThrow(
      "- UPSTASH_REDIS_REST_TOKEN: ",
    );
    expect(check({ VERCEL_ENV: "production", ...upstash })).not.toThrow();
  });

  test("相关模块都没开时生产环境也不要求", () => {
    expect(check({ VERCEL_ENV: "production" }, false)).not.toThrow();
  });

  test("本地、CI 和预览不要求", () => {
    expect(check({})).not.toThrow();
    expect(check({ VERCEL_ENV: "preview" })).not.toThrow();
  });

  test("REST 地址必须是 https", () => {
    expect(
      check({ ...upstash, UPSTASH_REDIS_REST_URL: "redis://example:6379" }),
    ).toThrow("- UPSTASH_REDIS_REST_URL: ");
  });

  test("ALLOW_UNRATELIMITED 只认 1 / true / 0 / false", () => {
    expect(check({ ALLOW_UNRATELIMITED: "true" })).not.toThrow();
    expect(check({ ALLOW_UNRATELIMITED: "yes" })).toThrow(
      "- ALLOW_UNRATELIMITED: ",
    );
  });
});

describe("upstashConfigured", () => {
  test("两个变量都要有，缺一个或空串都算没配", () => {
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

  test("自托管生产（NODE_ENV=production 且不在 Vercel 上）漏配时拒绝请求", () => {
    expect(missingRedisPolicy({ NODE_ENV: "production" }, enabled)).toBe(
      "unavailable",
    );
  });

  test("本地开发、测试和 CI 照常放行", () => {
    expect(missingRedisPolicy({ NODE_ENV: "development" }, enabled)).toBe(
      "allow",
    );
    expect(missingRedisPolicy({ NODE_ENV: "test" }, enabled)).toBe("allow");
    // NODE_ENV 没设置（本地 `pnpm dev` 之外的场景）不按生产处理。
    expect(missingRedisPolicy({}, enabled)).toBe("allow");
  });

  test("Vercel 预览照常放行；Vercel 生产拒绝（变量校验会先拦下来）", () => {
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

  test("ALLOW_UNRATELIMITED=1 / true 时显式放行，0 或不填照旧拒绝", () => {
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

  test("限流相关的模块都没开时不判定", () => {
    expect(
      missingRedisPolicy({ NODE_ENV: "production" }, { enabled: false }),
    ).toBe("allow");
  });
});
