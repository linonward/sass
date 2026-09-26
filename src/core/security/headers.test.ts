// @vitest-environment node
import { describe, expect, test } from "vitest";

import {
  contentSecurityPolicy,
  securityHeaders,
  staticSecurityHeaders,
} from "./headers";

function directives(csp: string) {
  return Object.fromEntries(
    csp
      .split("; ")
      .map((part) => part.split(" "))
      .map(([name, ...values]) => [name, values]),
  );
}

describe("contentSecurityPolicy", () => {
  test("生产：不加 'unsafe-eval'，下发 upgrade-insecure-requests", () => {
    const csp = contentSecurityPolicy({ runtimeEnv: {}, isDev: false });
    expect(csp).not.toContain("'unsafe-eval'");
    expect(directives(csp)["upgrade-insecure-requests"]).toEqual([]);
  });

  test("开发：加 'unsafe-eval'，不下发 upgrade-insecure-requests", () => {
    const csp = contentSecurityPolicy({ runtimeEnv: {}, isDev: true });
    expect(directives(csp)["script-src"]).toContain("'unsafe-eval'");
    expect(directives(csp)["upgrade-insecure-requests"]).toBeUndefined();
  });

  test("R2_PUBLIC_URL 的源进图片、媒体和连接白名单", () => {
    const csp = contentSecurityPolicy({
      runtimeEnv: { R2_PUBLIC_URL: "https://s3.example.com" },
      isDev: false,
    });
    const parsed = directives(csp);
    for (const name of ["img-src", "media-src", "connect-src"]) {
      expect(parsed[name]).toContain("https://s3.example.com");
    }
    // 只取源，丢掉路径。
    const withPath = contentSecurityPolicy({
      runtimeEnv: { R2_PUBLIC_URL: "https://s3.example.com/nested/path" },
      isDev: false,
    });
    expect(withPath).toContain("https://s3.example.com");
    expect(withPath).not.toContain("/nested/path");
  });

  test("没配或配错 R2_PUBLIC_URL 时不抛错，只是少一个白名单项", () => {
    for (const value of [undefined, "", "  ", "not-a-url"]) {
      const csp = contentSecurityPolicy({
        runtimeEnv: { R2_PUBLIC_URL: value },
        isDev: false,
      });
      expect(csp).toContain("'self'");
      expect(csp).not.toContain("undefined");
    }
  });

  test("关键指令都在，且是一行（响应头里不能有换行）", () => {
    const csp = contentSecurityPolicy({ runtimeEnv: {}, isDev: false });
    expect(csp).not.toMatch(/[\r\n]/);
    expect(csp).not.toMatch(/ {2}/);
    expect(directives(csp)).toMatchObject({
      "default-src": ["'self'"],
      "object-src": ["'none'"],
      "base-uri": ["'self'"],
      "form-action": ["'self'"],
      "frame-ancestors": ["'none'"],
      "font-src": ["'self'"],
    });
    // Vercel Analytics / Speed Insights 的脚本域；Sentry 的 /monitoring 是同源，靠 'self'。
    expect(directives(csp)["script-src"]).toContain(
      "https://va.vercel-scripts.com",
    );
    expect(directives(csp)["connect-src"]).toContain("'self'");
  });
});

describe("Google One Tap 的白名单", () => {
  const credentials = {
    GOOGLE_CLIENT_ID: "123.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "secret",
  };

  test("启用时放行 GIS 的脚本、样式、服务端点和提示 iframe", () => {
    const parsed = directives(
      contentSecurityPolicy({ runtimeEnv: credentials, isDev: false }),
    );
    expect(parsed["script-src"]).toContain(
      "https://accounts.google.com/gsi/client",
    );
    expect(parsed["style-src"]).toContain(
      "https://accounts.google.com/gsi/style",
    );
    expect(parsed["connect-src"]).toContain("https://accounts.google.com/gsi/");
    // frame-src 一旦出现就取代 default-src 对 frame 的回落，所以必须带 'self'：
    // e2e/security-headers.spec.ts 靠同源 iframe 真的被加载才能等到 X-Frame-Options 的拒绝。
    expect(parsed["frame-src"]).toEqual([
      "'self'",
      "https://accounts.google.com/gsi/",
    ]);
  });

  test("没配凭据时一条都不出现，frame-src 整条不下发", () => {
    const csp = contentSecurityPolicy({ runtimeEnv: {}, isDev: false });
    expect(csp).not.toContain("accounts.google.com");
    // 不下发才能在未启用时保持原有策略（frame 继续回落 default-src 'self'）。
    expect(directives(csp)["frame-src"]).toBeUndefined();
  });

  test("预览部署，以及只填了 client ID 都算未启用", () => {
    for (const runtimeEnv of [
      { ...credentials, VERCEL_ENV: "preview" },
      { GOOGLE_CLIENT_ID: credentials.GOOGLE_CLIENT_ID },
    ]) {
      const csp = contentSecurityPolicy({ runtimeEnv, isDev: false });
      expect(csp).not.toContain("accounts.google.com");
      expect(directives(csp)["frame-src"]).toBeUndefined();
    }
  });
});

describe("staticSecurityHeaders", () => {
  test("四个固定头", () => {
    expect(staticSecurityHeaders()).toEqual([
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "DENY" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
      },
    ]);
  });

  test("不发 HSTS：域名定下来之前开会被浏览器记住（上线清单里手动开）", () => {
    expect(
      staticSecurityHeaders().map((header) => header.key.toLowerCase()),
    ).not.toContain("strict-transport-security");
  });
});

describe("securityHeaders", () => {
  test("固定头 + CSP，CSP 只有一条", () => {
    const headers = securityHeaders({ runtimeEnv: {}, isDev: false });
    expect(
      headers.filter((h) => h.key === "Content-Security-Policy"),
    ).toHaveLength(1);
    expect(headers.map((h) => h.key)).toEqual([
      ...staticSecurityHeaders().map((h) => h.key),
      "Content-Security-Policy",
    ]);
  });
});
