// @vitest-environment node
// t3-env 只在服务端校验 server 变量，jsdom 下会被当成客户端。
import { describe, expect, test } from "vitest";

import { createAppEnv } from "../create-env";
import {
  authServerEnv,
  googleClientId,
  googleCredentials,
  resolveAuthBaseURL,
} from "./env";

const secret = "x".repeat(32);

function check(runtimeEnv: Record<string, string | undefined>) {
  return () => createAppEnv({ server: authServerEnv(runtimeEnv), runtimeEnv });
}

describe("authServerEnv", () => {
  test("缺少 BETTER_AUTH_SECRET 时报错", () => {
    expect(check({})).toThrow("- BETTER_AUTH_SECRET: ");
  });

  test("BETTER_AUTH_SECRET 太短时报错", () => {
    expect(check({ BETTER_AUTH_SECRET: "short" })).toThrow(
      "- BETTER_AUTH_SECRET: ",
    );
  });

  test("本地、CI 和预览不要求 Google 凭据", () => {
    expect(check({ BETTER_AUTH_SECRET: secret })).not.toThrow();
    expect(
      check({ BETTER_AUTH_SECRET: secret, VERCEL_ENV: "preview" }),
    ).not.toThrow();
  });

  test("Vercel 生产环境缺少 Google 凭据时报错", () => {
    expect(
      check({ BETTER_AUTH_SECRET: secret, VERCEL_ENV: "production" }),
    ).toThrow("- GOOGLE_CLIENT_ID: ");
  });
});

describe("googleCredentials", () => {
  test("预览部署不启用 Google 登录", () => {
    expect(
      googleCredentials({
        VERCEL_ENV: "preview",
        GOOGLE_CLIENT_ID: "id",
        GOOGLE_CLIENT_SECRET: "s",
      }),
    ).toBeUndefined();
  });

  test("两项齐全才返回", () => {
    expect(googleCredentials({ GOOGLE_CLIENT_ID: "id" })).toBeUndefined();
    expect(
      googleCredentials({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s" }),
    ).toEqual({ clientId: "id", clientSecret: "s" });
  });
});

describe("googleClientId", () => {
  test("与 googleCredentials 同一判断，只取 client ID", () => {
    expect(googleClientId({})).toBeUndefined();
    expect(googleClientId({ GOOGLE_CLIENT_ID: "id" })).toBeUndefined();
    expect(
      googleClientId({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s" }),
    ).toBe("id");
  });

  test("预览部署同样是 undefined（页面按钮、One Tap 与 CSP 都靠它判断）", () => {
    expect(
      googleClientId({
        VERCEL_ENV: "preview",
        GOOGLE_CLIENT_ID: "id",
        GOOGLE_CLIENT_SECRET: "s",
      }),
    ).toBeUndefined();
  });
});

describe("resolveAuthBaseURL", () => {
  test("显式设置的 BETTER_AUTH_URL 优先", () => {
    expect(
      resolveAuthBaseURL(
        {
          BETTER_AUTH_URL: "https://auth.example.com",
          VERCEL_ENV: "production",
        },
        "example.com",
      ),
    ).toBe("https://auth.example.com");
  });

  test("生产部署：允许生产域名，兜底为生产域名", () => {
    expect(
      resolveAuthBaseURL(
        {
          VERCEL_ENV: "production",
          VERCEL_PROJECT_PRODUCTION_URL: "example.com",
          VERCEL_URL: "app-abc123-team.vercel.app",
        },
        "example.com",
      ),
    ).toEqual({
      allowedHosts: ["example.com", "app-abc123-team.vercel.app"],
      protocol: "https",
      fallback: "https://example.com",
    });
  });

  test("预览部署：只允许本次部署的地址，不放开整个 vercel.app", () => {
    const baseURL = resolveAuthBaseURL(
      {
        VERCEL_ENV: "preview",
        VERCEL_BRANCH_URL: "app-git-feat-team.vercel.app",
        VERCEL_URL: "app-abc123-team.vercel.app",
      },
      "example.com",
    );
    expect(baseURL).toEqual({
      allowedHosts: [
        "example.com",
        "app-git-feat-team.vercel.app",
        "app-abc123-team.vercel.app",
      ],
      protocol: "https",
      fallback: "https://app-git-feat-team.vercel.app",
    });
  });

  test("本地：允许 localhost 任意端口", () => {
    expect(resolveAuthBaseURL({}, "example.com")).toEqual({
      allowedHosts: ["localhost:*", "127.0.0.1:*"],
      protocol: "http",
    });
  });
});
