import { describe, expect, test } from "vitest";

import { canDownload, productForPlan, updatesUntil } from "./access";

const config = {
  enabled: true,
  products: [{ id: "template", planId: "lifetime", updateMonths: 12 }],
};

describe("updatesUntil", () => {
  test("N calendar months after the purchase time", () => {
    expect(
      updatesUntil(new Date("2026-09-30T08:00:00Z"), 12).toISOString(),
    ).toBe("2027-09-30T08:00:00.000Z");
  });

  test("month-end overflow rolls forward per Date's rules, never earlier than N months", () => {
    const until = updatesUntil(new Date("2026-01-31T00:00:00Z"), 1);
    expect(until.getTime()).toBeGreaterThanOrEqual(
      new Date("2026-02-28T00:00:00Z").getTime(),
    );
  });
});

describe("productForPlan", () => {
  test("the product a plan maps to", () => {
    expect(productForPlan(config, "lifetime")?.id).toBe("template");
  });

  test("no product for a plan that doesn't sell files, no plan, or a disabled module", () => {
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

  test("versions released within the updates period can be downloaded, including at the cutoff instant", () => {
    expect(canDownload(entitlement, release("2026-10-01T00:00:00Z"))).toBe(
      true,
    );
    expect(canDownload(entitlement, release("2027-09-30T00:00:00Z"))).toBe(
      true,
    );
  });

  test("versions released before the purchase can be downloaded too (you bought the latest at the time)", () => {
    expect(canDownload(entitlement, release("2025-01-01T00:00:00Z"))).toBe(
      true,
    );
  });

  test("versions released after the updates period, of another product, or with a revoked grant can't be downloaded", () => {
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
