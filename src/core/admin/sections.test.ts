import { describe, expect, test } from "vitest";

import { revenueEnabled } from "./sections";

/** 只关心判定用的字段，其余用不到（函数签名也只取 plans）。 */
const withPrices = (...prices: number[]) => ({
  plans: prices.map((price) => ({ price })),
});

describe("收入区块的显隐判定", () => {
  // 免费部署上收入永远是 0 /「—」，不该占位置（见 README 的「后台」一节）。
  test("只有免费套餐时不显示", () => {
    expect(revenueEnabled(withPrices(0))).toBe(false);
    expect(revenueEnabled(withPrices(0, 0))).toBe(false);
  });

  test("没有套餐时不显示", () => {
    expect(revenueEnabled(withPrices())).toBe(false);
  });

  test("有任何一个付费套餐就显示", () => {
    expect(revenueEnabled(withPrices(0, 900))).toBe(true);
    expect(revenueEnabled(withPrices(2900))).toBe(true);
  });
});
