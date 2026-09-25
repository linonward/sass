import { describe, expect, test, vi } from "vitest";

import { preferredLocale } from "./locale";

vi.mock("@/core/i18n/routing", () => ({
  routing: { locales: ["en", "de"], defaultLocale: "en" },
}));

describe("preferredLocale", () => {
  test.each([
    [{ locale: "de" }, "de"],
    [{ locale: "fr" }, "en"],
    [{ locale: null }, "en"],
    [{}, "en"],
  ])("%o → %s", (user, expected) => {
    expect(preferredLocale(user)).toBe(expected);
  });
});
