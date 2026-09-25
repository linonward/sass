import { describe, expect, test } from "vitest";

import { uploadConfigSchema } from "@/core/config/schema";

import { buildObjectKey, validateUpload } from "./validate";

const config = uploadConfigSchema.parse({
  allowedMimeTypes: ["image/png", "application/pdf"],
  maxFileSize: 1000,
});

describe("validateUpload", () => {
  test("允许的类型和大小通过，类型统一成小写", () => {
    expect(validateUpload({ mime: "image/png", size: 1000 }, config)).toEqual({
      ok: true,
      value: { mime: "image/png", size: 1000 },
    });
    expect(
      validateUpload({ mime: " Application/PDF ", size: 1 }, config),
    ).toMatchObject({ ok: true, value: { mime: "application/pdf" } });
  });

  test.each([
    ["不在允许列表里", "image/webp"],
    ["可执行脚本的类型", "image/svg+xml"],
    ["带参数", "image/png; charset=utf-8"],
    ["空", ""],
    ["不是字符串", 42],
    ["缺失", undefined],
  ])("类型%s时拒绝", (_, mime) => {
    expect(validateUpload({ mime, size: 10 }, config)).toEqual({
      ok: false,
      error: "invalid_type",
    });
  });

  test("超过上限时拒绝", () => {
    expect(validateUpload({ mime: "image/png", size: 1001 }, config)).toEqual({
      ok: false,
      error: "too_large",
    });
  });

  test.each([0, -1, 1.5, "10", Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    "大小非法（%s）时拒绝",
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

  test("格式为 <userId>/<yyyy-mm>/<uuid>.<ext>，扩展名由类型决定", () => {
    expect(
      buildObjectKey({
        userId: "user_1",
        mime: "image/jpeg",
        now: new Date("2026-09-25T12:00:00Z"),
        id,
      }),
    ).toBe(`user_1/2026-09/${id}.jpg`);
  });

  test("月份按 UTC 计算", () => {
    expect(
      buildObjectKey({
        userId: "u",
        mime: "application/pdf",
        now: new Date("2026-12-31T23:30:00-05:00"),
        id,
      }),
    ).toBe(`u/2027-01/${id}.pdf`);
  });

  test("默认生成随机 UUID", () => {
    const key = buildObjectKey({ userId: "u", mime: "image/png" });
    expect(key).toMatch(
      /^u\/\d{4}-\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$/,
    );
    expect(buildObjectKey({ userId: "u", mime: "image/png" })).not.toBe(key);
  });

  test.each(["../etc", "a/b", "", "a b"])(
    "userId 含路径字符（%j）时抛错",
    (userId) => {
      expect(() => buildObjectKey({ userId, mime: "image/png" })).toThrow();
    },
  );
});
