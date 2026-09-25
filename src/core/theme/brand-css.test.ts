import { describe, expect, test } from "vitest";

import { brandCss, foregroundFor } from "./brand-css";

describe("foregroundFor", () => {
  test.each([
    ["#000000", "oklch(0.985 0 0)"],
    ["#4f46e5", "oklch(0.985 0 0)"],
    ["#ffffff", "oklch(0.145 0 0)"],
    ["#facc15", "oklch(0.145 0 0)"],
    ["#fff", "oklch(0.145 0 0)"],
  ])("%s 上使用 %s", (hex, expected) => {
    expect(foregroundFor(hex)).toBe(expected);
  });
});

describe("brandCss", () => {
  test("亮色与暗色都覆盖 primary 相关变量", () => {
    const css = brandCss({ primaryColor: "#4f46e5", logo: "/logo.svg" });
    expect(css).toContain("html:root,html.dark{");
    expect(css).toContain("--primary:#4f46e5;");
    expect(css).toContain("--primary-foreground:oklch(0.985 0 0);");
    expect(css).toContain("--ring:#4f46e5;");
  });
});
