import { describe, expect, test } from "vitest";

import { splitLocale } from "./proxy";

describe("splitLocale", () => {
  test("no locale prefix returns the default locale en", () => {
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

  test("a zh prefix resolves to the Chinese locale", () => {
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

  test("a disabled locale prefix falls back to the default locale and stays in the path", () => {
    expect(splitLocale("/de/pricing")).toEqual({
      locale: "en",
      path: "/de/pricing",
    });
    expect(splitLocale("/ja")).toEqual({ locale: "en", path: "/ja" });
  });

  test("an empty path returns the default locale", () => {
    expect(splitLocale("")).toEqual({ locale: "en", path: "" });
  });

  test("single-segment path of an enabled locale", () => {
    expect(splitLocale("/zh")).toEqual({ locale: "zh", path: "/" });
  });

  test("a trailing slash doesn't affect parsing", () => {
    expect(splitLocale("/zh/pricing/")).toEqual({
      locale: "zh",
      path: "/pricing/",
    });
  });

  test("a multi-segment path with a disabled locale prefix is treated as a path", () => {
    expect(splitLocale("/de/foo/bar")).toEqual({
      locale: "en",
      path: "/de/foo/bar",
    });
  });
});

// The middleware matcher regex is a static compile-time string, pinned in `config.matcher` in
// proxy.ts. Next.js matches it against the full pathname (equivalent to adding ^), so the tests
// anchor it at the start explicitly. If proxy.ts changes the matcher, update this test too.
const MATCHER =
  "/((?!api/|trpc|_next|_vercel|opengraph-image|icon$|monitoring|.*\\..*).*)";
const re = new RegExp(`^${MATCHER}`);

describe("middleware matcher regex", () => {
  test("ordinary page paths match", () => {
    expect(re.test("/pricing")).toBe(true);
    expect(re.test("/zh/pricing")).toBe(true);
    expect(re.test("/sign-in")).toBe(true);
    expect(re.test("/zh/sign-in")).toBe(true);
    expect(re.test("/dashboard")).toBe(true);
  });

  test("API paths don't match", () => {
    // `api/` in the matcher excludes every /api/** endpoint
    expect(re.test("/api/auth/sign-in")).toBe(false);
    expect(re.test("/api/webhooks/creem")).toBe(false);
    expect(re.test("/api/ai/chat")).toBe(false);
  });

  test("Next internal paths don't match", () => {
    expect(re.test("/_next/static/chunks/app.js")).toBe(false);
  });

  test("static files with an extension don't match", () => {
    expect(re.test("/favicon.ico")).toBe(false);
    expect(re.test("/sitemap.xml")).toBe(false);
    expect(re.test("/robots.txt")).toBe(false);
    expect(re.test("/image.png")).toBe(false);
  });

  test("metadata routes don't match", () => {
    expect(re.test("/opengraph-image")).toBe(false);
    expect(re.test("/icon")).toBe(false);
  });

  test("the Sentry tunnel doesn't match", () => {
    expect(re.test("/monitoring")).toBe(false);
  });
});
