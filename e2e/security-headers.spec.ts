import { expect, test } from "@playwright/test";

import type { APIResponse } from "@playwright/test";

/**
 * 全站安全头（策略与白名单见 src/core/security/headers.ts）。
 * 这里只锁「头和关键指令在不在」，具体白名单由 src/core/security/headers.test.ts 单测覆盖。
 */
const REQUIRED_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "permissions-policy":
    "camera=(), microphone=(), geolocation=(), browsing-topics=()",
};

function expectSecurityHeaders(response: APIResponse, path: string) {
  const headers = response.headers();
  for (const [key, value] of Object.entries(REQUIRED_HEADERS)) {
    expect(headers[key], `${path} 的 ${key}`).toBe(value);
  }

  const csp = headers["content-security-policy"] ?? "";
  for (const directive of [
    "default-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ]) {
    expect(csp, `${path} 的 CSP`).toContain(directive);
  }
  // 响应头里不能有换行，否则整条 CSP 会失效。
  expect(csp, `${path} 的 CSP`).not.toMatch(/[\r\n]/);
  return csp;
}

test("页面、静态文件与 API 都带全站安全头", async ({ request }) => {
  // 首页经 proxy 重写到 /en；/api 和带扩展名的文件被 proxy 的 matcher 排除，
  // 只经过 next.config.ts 的 headers()。
  const cases = [
    { path: "/", status: 200 },
    { path: "/pricing", status: 200 },
    { path: "/blog", status: 200 },
    { path: "/logo.svg", status: 200 },
    { path: "/sitemap.xml", status: 200 },
    { path: "/api/billing/status", status: 401 },
    { path: "/api/nope", status: 404 },
    { path: "/missing.png", status: 404 },
  ];

  for (const { path, status } of cases) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(status);
    expectSecurityHeaders(response, path);
  }
});

test("proxy 发出的重定向也带这些头", async ({ request }) => {
  // 未登录访问 /dashboard：src/proxy.ts 按 cookie 直接跳登录页。
  const response = await request.get("/dashboard", { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(response.headers()["location"]).toContain("/sign-in");
  expectSecurityHeaders(response, "/dashboard");
});

test("/admin 不能被 iframe 嵌套", async ({ page, request }) => {
  const response = await request.get("/admin");
  expectSecurityHeaders(response, "/admin");

  // 真在页面里插一个 iframe：浏览器应该按 X-Frame-Options / frame-ancestors 拒绝渲染，
  // 并在控制台留下拒绝记录。
  await page.goto("/");
  const refused = page.waitForEvent("console", {
    predicate: (message) =>
      /X-Frame-Options|frame-ancestors/i.test(message.text()),
    timeout: 10_000,
  });
  await page.evaluate(() => {
    const frame = document.createElement("iframe");
    frame.src = "/admin";
    document.body.append(frame);
  });
  await refused;
});

test("关键页面没有 CSP 违规", async ({ page }) => {
  // CSP 拦掉的东西可能只是静默失败（图片变破图、脚本不执行），所以除了这条断言，
  // 还要看 e2e/web-analytics.spec.ts 的脚本加载断言和 PR 里的真浏览器验证。
  //
  // 只认「带 Content Security Policy 字样」的行：`Refused to load/execute ...` 这类
  // 拒绝信息里 MIME 不符（本地构建 /_vercel/insights/script.js 会 404 成 HTML，
  // 撞上 X-Content-Type-Options: nosniff）也长这样，但它不是 CSP 违规 ——
  // 那不是白名单能修的，用宽正则会把构建环境问题记成安全头回归。
  const violations: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error" && /Content Security Policy/i.test(text)) {
      violations.push(text);
    }
  });

  // 静态预渲染的营销页、博客、后台（404）、带语言前缀的路径、登录页。
  for (const path of [
    "/",
    "/pricing",
    "/blog",
    "/blog/hello-world",
    "/zh",
    "/admin",
    "/sign-in",
  ]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
  }

  expect(violations, violations.join("\n")).toEqual([]);
});
