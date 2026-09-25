import { describe, expect, test } from "vitest";

import { safeCallbackURL } from "./callback-url";

describe("safeCallbackURL", () => {
  test.each([
    ["/dashboard", "/dashboard"],
    ["/de/dashboard?tab=1#top", "/de/dashboard?tab=1#top"],
    ["/settings/../dashboard", "/dashboard"],
  ])("站内路径 %s 保留为 %s", (input, expected) => {
    expect(safeCallbackURL(input, "/fallback")).toBe(expected);
  });

  test.each([
    [undefined],
    [""],
    ["https://evil.example"],
    ["//evil.example/path"],
    ["/\\evil.example"],
    ["javascript:alert(1)"],
    ["dashboard"],
    ["/sign-in"],
    ["/de/sign-in"],
  ])("不安全或无意义的 %s 回退到默认地址", (input) => {
    expect(safeCallbackURL(input, "/fallback")).toBe("/fallback");
  });
});
