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

describe("billing.plans 交易字段", () => {
  test("按 interval 推导 type，credits 默认 0", () => {
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
      "type 与 interval 不一致",
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
      "一次性套餐用了订阅周期",
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
      "付费套餐缺少产品 ID",
      { ...base, id: "pro", price: 19, interval: "month" },
      "billing.plans.0.providerProductId",
    ],
    [
      "免费套餐填了产品 ID",
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
      "credits 不是非负整数",
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
  ])("%s 时报错", (_name, plan, path) => {
    expect(() => withPlans([plan])).toThrow(`- ${path}: `);
  });
});

describe("查找套餐", () => {
  test("按 ID 和产品 ID 找到站点配置里的套餐", () => {
    const paid = siteConfig.billing.plans.find((p) => p.providerProductId);
    expect(paid).toBeDefined();
    expect(getPlan(paid!.id)).toBe(paid);
    expect(planByProductId(paid!.providerProductId!)).toBe(paid);
    expect(getPlan("missing")).toBeUndefined();
    expect(planByProductId("missing")).toBeUndefined();
  });
});
