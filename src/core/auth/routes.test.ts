import { expect, test } from "vitest";

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
