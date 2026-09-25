import { describe, expect, test, vi } from "vitest";

import { resolveRequestLocale } from "./locale";

vi.mock("../i18n/routing", () => ({
  routing: { locales: ["en", "de"], defaultLocale: "en" },
}));

describe("resolveRequestLocale", () => {
  test("优先使用 x-locale", () => {
    const headers = new Headers({ "x-locale": "de", cookie: "NEXT_LOCALE=en" });
    expect(resolveRequestLocale(headers)).toBe("de");
  });

  test("其次使用 NEXT_LOCALE cookie", () => {
    expect(
      resolveRequestLocale(new Headers({ cookie: "a=1; NEXT_LOCALE=de" })),
    ).toBe("de");
  });

  test("未启用的语言和缺失时回退到默认语言", () => {
    expect(resolveRequestLocale(new Headers({ "x-locale": "fr" }))).toBe("en");
    expect(resolveRequestLocale(undefined)).toBe("en");
  });
});
