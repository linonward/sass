import { describe, expect, test } from "vitest";

import { canDownload, productForPlan, updatesUntil } from "./access";

const config = {
  enabled: true,
  products: [{ id: "template", planId: "lifetime", updateMonths: 12 }],
};

describe("updatesUntil", () => {
  test("购买时间往后 N 个日历月", () => {
    expect(
      updatesUntil(new Date("2026-09-30T08:00:00Z"), 12).toISOString(),
    ).toBe("2027-09-30T08:00:00.000Z");
  });

  test("月末溢出按 Date 的规则顺延，不会早于 N 个月", () => {
    const until = updatesUntil(new Date("2026-01-31T00:00:00Z"), 1);
    expect(until.getTime()).toBeGreaterThanOrEqual(
      new Date("2026-02-28T00:00:00Z").getTime(),
    );
  });
});

describe("productForPlan", () => {
  test("套餐对应的产品", () => {
    expect(productForPlan(config, "lifetime")?.id).toBe("template");
  });

  test("不卖文件的套餐、没有套餐、模块关闭时都没有产品", () => {
    expect(productForPlan(config, "pro")).toBeUndefined();
    expect(productForPlan(config, undefined)).toBeUndefined();
    expect(
      productForPlan({ ...config, enabled: false }, "lifetime"),
    ).toBeUndefined();
  });
});

describe("canDownload", () => {
  const entitlement = {
    productId: "template",
    updatesUntil: new Date("2027-09-30T00:00:00Z"),
    revokedAt: null,
  };
  const release = (publishedAt: string, productId = "template") => ({
    productId,
    publishedAt: new Date(publishedAt),
  });

  test("更新期内发布的版本能下，包括截止那一刻", () => {
    expect(canDownload(entitlement, release("2026-10-01T00:00:00Z"))).toBe(
      true,
    );
    expect(canDownload(entitlement, release("2027-09-30T00:00:00Z"))).toBe(
      true,
    );
  });

  test("购买前发布的版本也能下（买到的是当时最新版）", () => {
    expect(canDownload(entitlement, release("2025-01-01T00:00:00Z"))).toBe(
      true,
    );
  });

  test("更新期之后发布的、别的产品的、授权被收回的都不能下", () => {
    expect(canDownload(entitlement, release("2027-09-30T00:00:01Z"))).toBe(
      false,
    );
    expect(
      canDownload(entitlement, release("2026-10-01T00:00:00Z", "ebook")),
    ).toBe(false);
    expect(
      canDownload(
        { ...entitlement, revokedAt: new Date("2026-10-02T00:00:00Z") },
        release("2026-10-01T00:00:00Z"),
      ),
    ).toBe(false);
  });
});
