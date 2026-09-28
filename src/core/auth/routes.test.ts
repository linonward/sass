import { expect, test } from "vitest";

import siteConfig from "../../../site.config";
import {
  AFTER_SIGN_IN_PATH,
  SIGN_IN_PATH,
  isDisabledPath,
  isProtectedPath,
  protectedPrefixes,
} from "./routes";

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

test("前缀匹配的边界：同名前缀不算命中", () => {
  // `/dashboards` 不是 `/dashboard` 的子路径。
  expect(isProtectedPath("/dashboards")).toBe(false);
  expect(isProtectedPath("/settings-other")).toBe(false);
  expect(isProtectedPath("/api-keys-other")).toBe(false);
  // 命中前缀本身和它的子路径。
  expect(isProtectedPath("/settings")).toBe(true);
  expect(isProtectedPath("/settings/security")).toBe(true);
  expect(isProtectedPath("/api-keys")).toBe(true);
});

test("边界：空路径、根路径、语言前缀都不需要登录", () => {
  for (const path of ["", "/", "/zh", "/zh/", "/sign-in", "/zh/sign-in"]) {
    expect(isProtectedPath(path)).toBe(false);
  }
});

test("登录页和登录后落地页的常量与实际拦截一致", () => {
  expect(isProtectedPath(SIGN_IN_PATH)).toBe(false);
  expect(isDisabledPath(SIGN_IN_PATH)).toBe(false);
  expect(isProtectedPath(AFTER_SIGN_IN_PATH)).toBe(true);
  expect(isDisabledPath(AFTER_SIGN_IN_PATH)).toBe(false);
});

test("/admin 不在 cookie 拦截名单里：后台自己在 layout 里查角色", () => {
  // 进了 protectedPrefixes 的话，未登录访客会先被送去登录页，
  // 而 /admin 对任何非管理员都该一律 404（见 README 的权限边界）。
  expect(protectedPrefixes).not.toContain("/admin");
  expect(isProtectedPath("/admin")).toBe(false);
  expect(isProtectedPath("/admin/users")).toBe(false);
  expect(isDisabledPath("/admin")).toBe(false);
});

test("同一路径不会既需要登录又直接 404", () => {
  for (const prefix of protectedPrefixes) {
    expect(isDisabledPath(prefix)).toBe(false);
  }
});

test("/invoices 的拦截跟随示例模块的开关：开着要登录，关着直接 404", () => {
  const on = siteConfig.features.examples.invoices;
  expect(isProtectedPath("/invoices")).toBe(on);
  expect(isDisabledPath("/invoices")).toBe(!on);
  expect(isDisabledPath("/invoices/42")).toBe(!on);
  expect(isDisabledPath("/invoices-other")).toBe(false);
});
