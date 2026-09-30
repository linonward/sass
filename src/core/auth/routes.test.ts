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
])("%s requires sign-in: %s", (path, expected) => {
  expect(isProtectedPath(path)).toBe(expected);
});

test("business pages in site.config.ts dashboard.nav require sign-in automatically", () => {
  for (const { href } of siteConfig.dashboard.nav) {
    expect(isProtectedPath(href)).toBe(true);
    expect(isProtectedPath(`${href}/detail`)).toBe(true);
  }
});

test("/referrals follows the module flag: requires sign-in when on, 404s when off", () => {
  const on = siteConfig.acquisition.referrals.enabled;
  // When off, it must not be in protectedPrefixes: if the proxy redirected to sign-in first,
  // signed-out visitors would get a 307 and signed-in users a 404.
  expect(isProtectedPath("/referrals")).toBe(on);
  expect(isDisabledPath("/referrals")).toBe(!on);
  // Subpaths and prefix boundaries behave the same as isProtectedPath.
  expect(isDisabledPath("/referrals/history")).toBe(!on);
  expect(isDisabledPath("/referrals-other")).toBe(false);
});

test("prefix matching boundary: a longer name sharing the prefix doesn't match", () => {
  // `/dashboards` is not a subpath of `/dashboard`.
  expect(isProtectedPath("/dashboards")).toBe(false);
  expect(isProtectedPath("/settings-other")).toBe(false);
  expect(isProtectedPath("/api-keys-other")).toBe(false);
  // The prefix itself and its subpaths match.
  expect(isProtectedPath("/settings")).toBe(true);
  expect(isProtectedPath("/settings/security")).toBe(true);
  expect(isProtectedPath("/api-keys")).toBe(true);
});

test("edge: empty paths, the root path, and locale prefixes don't require sign-in", () => {
  for (const path of ["", "/", "/zh", "/zh/", "/sign-in", "/zh/sign-in"]) {
    expect(isProtectedPath(path)).toBe(false);
  }
});

test("the sign-in page and post-sign-in landing page constants match the actual gating", () => {
  expect(isProtectedPath(SIGN_IN_PATH)).toBe(false);
  expect(isDisabledPath(SIGN_IN_PATH)).toBe(false);
  expect(isProtectedPath(AFTER_SIGN_IN_PATH)).toBe(true);
  expect(isDisabledPath(AFTER_SIGN_IN_PATH)).toBe(false);
});

test("/admin is not in the cookie gate list: admin checks the role in its own layout", () => {
  // If it were in protectedPrefixes, signed-out visitors would be sent to sign-in first, while
  // /admin should 404 for every non-admin (see "Error and permission boundaries" in the README).
  expect(protectedPrefixes).not.toContain("/admin");
  expect(isProtectedPath("/admin")).toBe(false);
  expect(isProtectedPath("/admin/users")).toBe(false);
  expect(isDisabledPath("/admin")).toBe(false);
});

test("no path both requires sign-in and 404s", () => {
  for (const prefix of protectedPrefixes) {
    expect(isDisabledPath(prefix)).toBe(false);
  }
});

test("/invoices follows the example module flag: requires sign-in when on, 404s when off", () => {
  const on = siteConfig.features.examples.invoices;
  expect(isProtectedPath("/invoices")).toBe(on);
  expect(isDisabledPath("/invoices")).toBe(!on);
  expect(isDisabledPath("/invoices/42")).toBe(!on);
  expect(isDisabledPath("/invoices-other")).toBe(false);
});
