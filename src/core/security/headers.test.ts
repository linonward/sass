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
