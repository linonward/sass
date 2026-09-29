import { describe, expect, test } from "vitest";

import { uploadConfigSchema } from "@/core/config/schema";

import { buildObjectKey, validateUpload } from "./validate";

const config = uploadConfigSchema.parse({
  allowedMimeTypes: ["image/png", "application/pdf"],
  maxFileSize: 1000,
});

describe("validateUpload", () => {
  test("accepts allowed types and sizes and lowercases the type", () => {
    expect(validateUpload({ mime: "image/png", size: 1000 }, config)).toEqual({
      ok: true,
      value: { mime: "image/png", size: 1000 },
    });
    expect(
      validateUpload({ mime: " Application/PDF ", size: 1 }, config),
    ).toMatchObject({ ok: true, value: { mime: "application/pdf" } });
  });

  test.each([
    ["not in the allowlist", "image/webp"],
    ["script-capable", "image/svg+xml"],
    ["parameterized", "image/png; charset=utf-8"],
    ["empty", ""],
    ["not a string", 42],
    ["missing", undefined],
  ])("rejects a type that is %s", (_, mime) => {
    expect(validateUpload({ mime, size: 10 }, config)).toEqual({
      ok: false,
      error: "invalid_type",
    });
  });

  test("rejects sizes over the limit", () => {
    expect(validateUpload({ mime: "image/png", size: 1001 }, config)).toEqual({
      ok: false,
      error: "too_large",
    });
  });

  test.each([0, -1, 1.5, "10", Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an invalid size (%s)",
    (size) => {
      expect(validateUpload({ mime: "image/png", size }, config)).toEqual({
        ok: false,
        error: "invalid_size",
      });
    },
  );
});

describe("buildObjectKey", () => {
  const id = "0f8fad5b-d9cb-469f-a165-70867728950e";

  test("has the form <userId>/<yyyy-mm>/<uuid>.<ext>, with the extension decided by the type", () => {
    expect(
      buildObjectKey({
        userId: "user_1",
        mime: "image/jpeg",
        now: new Date("2026-09-25T12:00:00Z"),
        id,
      }),
    ).toBe(`user_1/2026-09/${id}.jpg`);
  });

  test("computes the month in UTC", () => {
    expect(
      buildObjectKey({
        userId: "u",
        mime: "application/pdf",
        now: new Date("2026-12-31T23:30:00-05:00"),
        id,
      }),
    ).toBe(`u/2027-01/${id}.pdf`);
  });

  test("generates a random UUID by default", () => {
    const key = buildObjectKey({ userId: "u", mime: "image/png" });
    expect(key).toMatch(
      /^u\/\d{4}-\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$/,
    );
    expect(buildObjectKey({ userId: "u", mime: "image/png" })).not.toBe(key);
  });

  test.each(["../etc", "a/b", "", "a b"])(
    "throws when userId contains path characters (%j)",
    (userId) => {
      expect(() => buildObjectKey({ userId, mime: "image/png" })).toThrow();
    },
  );
});
