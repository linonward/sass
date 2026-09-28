import { describe, expect, test, vi } from "vitest";

import {
  LOCALE_HEADER,
  resolveRequestLocale,
  withLocaleHeader,
} from "./locale";

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

  test("边界：x-locale 为空时继续看 cookie，而不是当未设置", () => {
    // 空串在 `if (fromHeader && ...)` 里是 falsy，所以会落到 cookie。
    expect(
      resolveRequestLocale(
        new Headers({ "x-locale": "", cookie: "NEXT_LOCALE=de" }),
      ),
    ).toBe("de");
  });

  test("边界：cookie 里的值先做 URL 解码再比对", () => {
    // next-intl 写 cookie 时会对值编码，解码后才是语言代码。
    expect(
      resolveRequestLocale(new Headers({ cookie: "NEXT_LOCALE=%64%65" })),
    ).toBe("de");
  });

  test("边界：只有整段 cookie 里的 NEXT_LOCALE 项才算，值里的同名片段不算", () => {
    // 正则要求 ^ 或 "; " 开头，redirect=NEXT_LOCALE=de 这种不该命中。
    expect(
      resolveRequestLocale(new Headers({ cookie: "redirect=NEXT_LOCALE=de" })),
    ).toBe("en");
  });

  test("边界：后面还有别的 cookie 时只取到分号为止", () => {
    expect(
      resolveRequestLocale(
        new Headers({ cookie: "NEXT_LOCALE=de; theme=dark" }),
      ),
    ).toBe("de");
  });

  test("边界：cookie 里有未启用的语言时回退默认语言", () => {
    expect(
      resolveRequestLocale(new Headers({ cookie: "NEXT_LOCALE=fr" })),
    ).toBe("en");
    expect(resolveRequestLocale(new Headers({ cookie: "NEXT_LOCALE=" }))).toBe(
      "en",
    );
  });

  test("边界：没有 cookie 头时也不崩", () => {
    expect(resolveRequestLocale(new Headers({ accept: "*/*" }))).toBe("en");
  });
});

describe("withLocaleHeader", () => {
  test("把当前界面语言写到每个请求上", () => {
    document.documentElement.lang = "de";
    const headers = new Headers();
    withLocaleHeader({ headers });
    expect(headers.get(LOCALE_HEADER)).toBe("de");
  });

  test("已有同名头时以文档上的语言为准（set 覆盖）", () => {
    document.documentElement.lang = "de";
    const headers = new Headers({ [LOCALE_HEADER]: "en" });
    withLocaleHeader({ headers });
    expect(headers.get(LOCALE_HEADER)).toBe("de");
  });
});
