import { expect, test } from "vitest";

import { isProtectedPath } from "./routes";

test.each([
  ["/dashboard", true],
  ["/dashboard/settings", true],
  ["/dashboards", false],
  ["/sign-in", false],
  ["/", false],
  // site.config.ts 的 dashboard.nav 里的业务页面自动需要登录。
  ["/example", true],
])("%s 是否需要登录：%s", (path, expected) => {
  expect(isProtectedPath(path)).toBe(expected);
});
