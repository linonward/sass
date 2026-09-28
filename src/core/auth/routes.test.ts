import { expect, test } from "vitest";

import siteConfig from "../../../site.config";
import { isDisabledPath, isProtectedPath } from "./routes";

test.each([
  ["/dashboard", true],
  ["/dashboard/settings", true],
  ["/dashboards", false],
  ["/sign-in", false],
  ["/", false],
])("%s 是否需要登录：%s", (path, expected) => {
  expect(isProtectedPath(path)).toBe(expected);
});

test("site.config.ts 的 dashboard.nav 里的业务页面自动需要登录", () => {
  for (const { href } of siteConfig.dashboard.nav) {
    expect(isProtectedPath(href)).toBe(true);
    expect(isProtectedPath(`${href}/detail`)).toBe(true);
  }
});

test("/referrals 的拦截跟随模块开关：开着要登录，关着直接 404", () => {
  const on = siteConfig.acquisition.referrals.enabled;
  // 关着时不能进 protectedPrefixes：proxy 先跳登录页的话，未登录是 307、已登录是 404。
  expect(isProtectedPath("/referrals")).toBe(on);
  expect(isDisabledPath("/referrals")).toBe(!on);
  // 子路径和前缀的边界与 isProtectedPath 一致。
  expect(isDisabledPath("/referrals/history")).toBe(!on);
  expect(isDisabledPath("/referrals-other")).toBe(false);
});
