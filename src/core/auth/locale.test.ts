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
  test("prefers x-locale", () => {
    const headers = new Headers({ "x-locale": "de", cookie: "NEXT_LOCALE=en" });
    expect(resolveRequestLocale(headers)).toBe("de");
  });

  test("falls back to the NEXT_LOCALE cookie next", () => {
    expect(
      resolveRequestLocale(new Headers({ cookie: "a=1; NEXT_LOCALE=de" })),
    ).toBe("de");
  });

  test("falls back to the default locale for disabled or missing locales", () => {
    expect(resolveRequestLocale(new Headers({ "x-locale": "fr" }))).toBe("en");
    expect(resolveRequestLocale(undefined)).toBe("en");
  });

  test("edge: an empty x-locale moves on to the cookie", () => {
    // An empty string is falsy in `if (fromHeader && ...)`, so it falls through to the cookie.
    expect(
      resolveRequestLocale(
        new Headers({ "x-locale": "", cookie: "NEXT_LOCALE=de" }),
      ),
    ).toBe("de");
  });

  test("edge: URL-decodes the cookie value before comparing", () => {
    // next-intl encodes the value when writing the cookie; it is only a locale code after decoding.
    expect(
      resolveRequestLocale(new Headers({ cookie: "NEXT_LOCALE=%64%65" })),
    ).toBe("de");
  });

  test("edge: only a real NEXT_LOCALE cookie counts, not the same text inside another value", () => {
    // The regex requires ^ or "; " before it, so redirect=NEXT_LOCALE=de must not match.
    expect(
      resolveRequestLocale(new Headers({ cookie: "redirect=NEXT_LOCALE=de" })),
    ).toBe("en");
  });

  test("edge: reads only up to the semicolon when other cookies follow", () => {
    expect(
      resolveRequestLocale(
        new Headers({ cookie: "NEXT_LOCALE=de; theme=dark" }),
      ),
    ).toBe("de");
  });

  test("edge: falls back to the default locale when the cookie holds a disabled locale", () => {
    expect(
      resolveRequestLocale(new Headers({ cookie: "NEXT_LOCALE=fr" })),
    ).toBe("en");
    expect(resolveRequestLocale(new Headers({ cookie: "NEXT_LOCALE=" }))).toBe(
      "en",
    );
  });

  test("edge: doesn't crash without a cookie header", () => {
    expect(resolveRequestLocale(new Headers({ accept: "*/*" }))).toBe("en");
  });

  test("doesn't throw on a malformed cookie encoding and falls back to the default locale", () => {
    // Each of these makes decodeURIComponent throw URIError: a truncated multi-byte sequence, a
    // lone percent sign, a non-hex escape, and half of a multi-byte sequence. A throw would bubble
    // up through user.create.after into the sign-up request (see the comment in locale.ts).
    for (const broken of ["%E0", "%", "%zz", "%E4%B8"]) {
      expect(
        resolveRequestLocale(new Headers({ cookie: `NEXT_LOCALE=${broken}` })),
      ).toBe("en");
    }
  });

  test("a broken cookie doesn't affect a valid x-locale", () => {
    const headers = new Headers({
      "x-locale": "de",
      cookie: "NEXT_LOCALE=%E0",
    });
    expect(resolveRequestLocale(headers)).toBe("de");
  });
});

describe("withLocaleHeader", () => {
  test("writes the current UI locale onto every request", () => {
    document.documentElement.lang = "de";
    const headers = new Headers();
    withLocaleHeader({ headers });
    expect(headers.get(LOCALE_HEADER)).toBe("de");
  });

  test("the document locale wins over an existing header of the same name (set overwrites)", () => {
    document.documentElement.lang = "de";
    const headers = new Headers({ [LOCALE_HEADER]: "en" });
    withLocaleHeader({ headers });
    expect(headers.get(LOCALE_HEADER)).toBe("de");
  });
});
