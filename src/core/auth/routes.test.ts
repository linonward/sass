import { expect, test } from "vitest";

import siteConfig from "../../../site.config";
import { isProtectedPath } from "./routes";

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
