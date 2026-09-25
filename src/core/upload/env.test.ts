// @vitest-environment node
// t3-env 只在服务端校验 server 变量，jsdom 下会被当成客户端。
import { describe, expect, test } from "vitest";

import { createAppEnv } from "../create-env";
import { uploadServerEnv } from "./env";

function check(
  runtimeEnv: Record<string, string | undefined>,
  { enabled = true, isPublic = false } = {},
) {
  return () =>
    createAppEnv({
      server: uploadServerEnv(runtimeEnv, { enabled, isPublic }),
      runtimeEnv,
    });
}

const r2 = {
  R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET: "uploads",
};
const production = { VERCEL_ENV: "production" };

describe("uploadServerEnv", () => {
  test("Vercel 生产环境开启上传时，缺少 R2 变量会报错", () => {
    for (const name of Object.keys(r2)) {
      expect(check(production)).toThrow(`- ${name}: `);
    }
    expect(check({ ...production, ...r2 })).not.toThrow();
  });

  test("公开访问时还要求 R2_PUBLIC_URL，且只能是 https 源地址", () => {
    const env = { ...production, ...r2 };
    expect(check(env, { isPublic: true })).toThrow("- R2_PUBLIC_URL: ");
    expect(
      check(
        { ...env, R2_PUBLIC_URL: "https://files.example.com" },
        { isPublic: true },
      ),
    ).not.toThrow();
    expect(
      check(
        { ...env, R2_PUBLIC_URL: "https://files.example.com/sub" },
        { isPublic: true },
      ),
    ).toThrow("- R2_PUBLIC_URL: ");
    expect(
      check({ ...env, R2_PUBLIC_URL: "http://files.example.com" }),
    ).toThrow("- R2_PUBLIC_URL: ");
  });

  test("没开上传、或不在生产环境时都不要求", () => {
    expect(check(production, { enabled: false })).not.toThrow();
    expect(check({})).not.toThrow();
    expect(check({ VERCEL_ENV: "preview" }, { isPublic: true })).not.toThrow();
  });

  test("account ID 格式错误时报错", () => {
    expect(check({ ...r2, R2_ACCOUNT_ID: "abc" })).toThrow("- R2_ACCOUNT_ID: ");
  });
});
