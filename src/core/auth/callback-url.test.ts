import { describe, expect, test } from "vitest";

import { safeCallbackURL } from "./callback-url";

describe("safeCallbackURL", () => {
  test.each([
    ["/dashboard", "/dashboard"],
    ["/de/dashboard?tab=1#top", "/de/dashboard?tab=1#top"],
    ["/settings/../dashboard", "/dashboard"],
  ])("keeps same-site path %s as %s", (input, expected) => {
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
  ])("falls back to the default for unsafe or meaningless %s", (input) => {
    expect(safeCallbackURL(input, "/fallback")).toBe("/fallback");
  });

  test.each([
    // The sign-in page with a locale prefix or a trailing slash also falls back; don't send the
    // user back to sign-in.
    ["/sign-in/"],
    ["/de/sign-in/"],
    // Relative paths without a leading slash fall back too.
    ["./dashboard"],
    ["../dashboard"],
    ["./."],
  ])(
    "falls back to the default for sign-in variants and relative paths: %s",
    (input) => {
      expect(safeCallbackURL(input, "/fallback")).toBe("/fallback");
    },
  );

  test("edge: encoded slashes are not treated as scheme-relative (browsers navigate without decoding)", () => {
    expect(safeCallbackURL("/%2f%2fevil.example", "/fallback")).toBe(
      "/%2f%2fevil.example",
    );
  });

  test("edge: keeps the root path and normalized paths", () => {
    expect(safeCallbackURL("/", "/fallback")).toBe("/");
    expect(safeCallbackURL("/..", "/fallback")).toBe("/");
    expect(safeCallbackURL("/./dashboard", "/fallback")).toBe("/dashboard");
    expect(safeCallbackURL("/dashboard/", "/fallback")).toBe("/dashboard/");
  });

  test("edge: keeps the query string and hash as-is; sign-in inside them is not the sign-in page", () => {
    expect(safeCallbackURL("/dashboard?next=/sign-in", "/fallback")).toBe(
      "/dashboard?next=/sign-in",
    );
    expect(safeCallbackURL("/dashboard#/sign-in", "/fallback")).toBe(
      "/dashboard#/sign-in",
    );
    // Only fall back when the whole pathname is exactly the sign-in page.
    expect(safeCallbackURL("/sign-in/extra", "/fallback")).toBe(
      "/sign-in/extra",
    );
  });
});
