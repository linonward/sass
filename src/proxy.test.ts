import { describe, expect, test } from "vitest";

import { splitLocale } from "./proxy";

describe("splitLocale", () => {
  test("无语言前缀时返回默认语言 en", () => {
    expect(splitLocale("/pricing")).toEqual({
      locale: "en",
      path: "/pricing",
    });
    expect(splitLocale("/")).toEqual({ locale: "en", path: "/" });
    expect(splitLocale("/blog/hello-world")).toEqual({
      locale: "en",
      path: "/blog/hello-world",
    });
  });

  test("zh 前缀解析为中文 locale", () => {
    expect(splitLocale("/zh/pricing")).toEqual({
      locale: "zh",
      path: "/pricing",
    });
    expect(splitLocale("/zh")).toEqual({ locale: "zh", path: "/" });
    expect(splitLocale("/zh/blog/hello-world")).toEqual({
      locale: "zh",
      path: "/blog/hello-world",
    });
  });

  test("未启用的语言前缀降级为默认语言，且保留在 path 里", () => {
    expect(splitLocale("/de/pricing")).toEqual({
      locale: "en",
      path: "/de/pricing",
    });
    expect(splitLocale("/ja")).toEqual({ locale: "en", path: "/ja" });
  });

  test("空路径返回默认语言", () => {
    expect(splitLocale("")).toEqual({ locale: "en", path: "" });
  });

  test("已启用语言的单段路径", () => {
    expect(splitLocale("/zh")).toEqual({ locale: "zh", path: "/" });
  });

  test("末尾带斜杠不影响解析", () => {
    expect(splitLocale("/zh/pricing/")).toEqual({
      locale: "zh",
      path: "/pricing/",
    });
  });

  test("多段未启用语言前缀当路径处理", () => {
    expect(splitLocale("/de/foo/bar")).toEqual({
      locale: "en",
      path: "/de/foo/bar",
    });
  });
});

// middleware matcher 的 regex 是编译时静态字符串，锁在 proxy.ts:73-74。
// Next.js 内部按完整 pathname 匹配（等效于加 ^），所以测试里显式锚到开头。
// 如果 proxy.ts 改了 matcher，这个测试也必须同步改。
const MATCHER =
  "/((?!api/|trpc|_next|_vercel|opengraph-image|icon$|monitoring|.*\\..*).*)";
const re = new RegExp(`^${MATCHER}`);

describe("middleware matcher regex", () => {
  test("普通页面路径匹配", () => {
    expect(re.test("/pricing")).toBe(true);
    expect(re.test("/zh/pricing")).toBe(true);
    expect(re.test("/sign-in")).toBe(true);
    expect(re.test("/zh/sign-in")).toBe(true);
    expect(re.test("/dashboard")).toBe(true);
  });

  test("API 路径不匹配", () => {
    // matcher 里的 `api/` 排除 /api/** 所有接口
    expect(re.test("/api/auth/sign-in")).toBe(false);
    expect(re.test("/api/webhooks/creem")).toBe(false);
    expect(re.test("/api/ai/chat")).toBe(false);
  });

  test("Next 内部路径不匹配", () => {
    expect(re.test("/_next/static/chunks/app.js")).toBe(false);
  });

  test("带扩展名的静态文件不匹配", () => {
    expect(re.test("/favicon.ico")).toBe(false);
    expect(re.test("/sitemap.xml")).toBe(false);
    expect(re.test("/robots.txt")).toBe(false);
    expect(re.test("/image.png")).toBe(false);
  });

  test("metadata 路由不匹配", () => {
    expect(re.test("/opengraph-image")).toBe(false);
    expect(re.test("/icon")).toBe(false);
  });

  test("Sentry tunnel 不匹配", () => {
    expect(re.test("/monitoring")).toBe(false);
  });
});
