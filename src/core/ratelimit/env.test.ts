// @vitest-environment node
// t3-env 只在服务端校验 server 变量，jsdom 下会被当成客户端。
import { describe, expect, test } from "vitest";

import { createAppEnv } from "../create-env";
import { rateLimitServerEnv } from "./env";

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
});
