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

  test.each([
    // 登录页带语言前缀或结尾斜杠时同样回退，别转回登录页。
    ["/sign-in/"],
    ["/de/sign-in/"],
    // 缺前导斜杠的相对路径也回退。
    ["./dashboard"],
    ["../dashboard"],
    ["./."],
  ])("登录页变体和相对路径 %s 回退到默认地址", (input) => {
    expect(safeCallbackURL(input, "/fallback")).toBe("/fallback");
  });

  test("边界：编码过的斜杠不会被当成 scheme-relative（浏览器不解码就跳）", () => {
    expect(safeCallbackURL("/%2f%2fevil.example", "/fallback")).toBe(
      "/%2f%2fevil.example",
    );
  });

  test("边界：根路径和规范化后的路径保留", () => {
    expect(safeCallbackURL("/", "/fallback")).toBe("/");
    expect(safeCallbackURL("/..", "/fallback")).toBe("/");
    expect(safeCallbackURL("/./dashboard", "/fallback")).toBe("/dashboard");
    expect(safeCallbackURL("/dashboard/", "/fallback")).toBe("/dashboard/");
  });

  test("边界：查询串和 hash 原样带回，路径里有 sign-in 不算登录页", () => {
    expect(safeCallbackURL("/dashboard?next=/sign-in", "/fallback")).toBe(
      "/dashboard?next=/sign-in",
    );
    expect(safeCallbackURL("/dashboard#/sign-in", "/fallback")).toBe(
      "/dashboard#/sign-in",
    );
    // 只有整段 pathname 恰好是登录页才回退。
    expect(safeCallbackURL("/sign-in/extra", "/fallback")).toBe(
      "/sign-in/extra",
    );
  });
});
