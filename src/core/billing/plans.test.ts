import { describe, expect, test } from "vitest";

import { defineConfig, type SiteConfigInput } from "@/core/config/schema";

import siteConfig from "../../../site.config";
import { getPlan, planByProductId } from "./plans";

const withPlans = (plans: unknown[]) =>
  defineConfig({
    ...siteConfig,
    billing: { currency: "USD", plans },
  } as SiteConfigInput);

const base = { features: ["a"] };

describe("billing.plans transaction fields", () => {
  test("type is derived from interval, credits default to 0", () => {
    const { plans } = withPlans([
      { ...base, id: "free", price: 0, interval: "month" },
      {
        ...base,
        id: "pro",
        price: 19,
        interval: "year",
        providerProductId: "p1",
      },
      {
        ...base,
        id: "once",
        price: 99,
        interval: "once",
        providerProductId: "p2",
        credits: 500,
      },
    ]).billing;

    expect(plans.map((p) => [p.id, p.type, p.credits])).toEqual([
      ["free", "subscription", 0],
      ["pro", "subscription", 0],
      ["once", "one_time", 500],
    ]);
  });

  test.each([
    [
      "type and interval disagree",
      {
        ...base,
        id: "pro",
        price: 19,
        interval: "once",
        type: "subscription",
        providerProductId: "p1",
      },
      "billing.plans.0.interval",
    ],
    [
      "a one-time plan uses a subscription interval",
      {
        ...base,
        id: "pro",
        price: 19,
        interval: "month",
        type: "one_time",
        providerProductId: "p1",
      },
      "billing.plans.0.interval",
    ],
    [
      "a paid plan is missing its product ID",
      { ...base, id: "pro", price: 19, interval: "month" },
      "billing.plans.0.providerProductId",
    ],
    [
      "a free plan has a product ID",
      {
        ...base,
        id: "free",
        price: 0,
        interval: "month",
        providerProductId: "p1",
      },
      "billing.plans.0.providerProductId",
    ],
    [
      "credits is not a non-negative integer",
      {
        ...base,
        id: "pro",
        price: 19,
        interval: "month",
        providerProductId: "p1",
        credits: 1.5,
      },
      "billing.plans.0.credits",
    ],
  ])("errors when %s", (_name, plan, path) => {
    expect(() => withPlans([plan])).toThrow(`- ${path}: `);
  });
});

describe("plan lookup", () => {
  test("finds site-config plans by ID and by product ID", () => {
    const paid = siteConfig.billing.plans.find((p) => p.providerProductId);
    expect(paid).toBeDefined();
    expect(getPlan(paid!.id)).toBe(paid);
    expect(planByProductId(paid!.providerProductId!)).toBe(paid);
    expect(getPlan("missing")).toBeUndefined();
    expect(planByProductId("missing")).toBeUndefined();
  });
});
