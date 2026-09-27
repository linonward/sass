import { describe, expect, test } from "vitest";

import { displayCurrency, formatMoney, formatMoneyList } from "./money";

/** 和 next-intl 的 getFormatter() 同一形状：透传给 Intl.NumberFormat。 */
const format = {
  number: (value: number, options?: Intl.NumberFormatOptions) =>
    new Intl.NumberFormat("en-US", options).format(value),
};

describe("币种归一化", () => {
  test("NULL 和空白用兜底币种，统一大写", () => {
    expect(displayCurrency(null, "USD")).toBe("USD");
    expect(displayCurrency("", "usd")).toBe("USD");
    expect(displayCurrency("  ", "USD")).toBe("USD");
    expect(displayCurrency("usd", "USD")).toBe("USD");
  });

  test("没有兜底时保持为空", () => {
    expect(displayCurrency(null, null)).toBeNull();
  });
});

describe("金额格式化", () => {
  test("NULL 币种用兜底币种，不显示成裸数字", () => {
    expect(formatMoney(format, 1250, null, "USD")).toBe("$12.50");
  });

  test("小写币种和大写是同一种货币", () => {
    expect(formatMoney(format, 1250, "usd", "USD")).toBe(
      formatMoney(format, 1250, "USD", "USD"),
    );
  });

  // orders.currency 是自由文本列：坏数据不能让整页 500（Intl 对非法币种抛 RangeError）。
  // 没有币种符号时沿用原样：`maximumFractionDigits: 2` 不补零（12.5 而不是 12.50）。
  test("非法币种退回「数字 + 原代码」，不抛", () => {
    expect(formatMoney(format, 1250, "USDC", "USD")).toBe("12.5 USDC");
    expect(formatMoney(format, 1250, "US dollar", null)).toBe("12.5 US DOLLAR");
  });

  test("没有兜底币种时只显示数字", () => {
    expect(formatMoney(format, 1250, null, null)).toBe("12.5");
  });

  test("整金额不带小数位", () => {
    expect(formatMoney(format, 1200, "USD", "USD")).toBe("$12");
    expect(formatMoney(format, 1200, "USDC", null)).toBe("12 USDC");
  });
});

describe("一格多个币种", () => {
  test("空的显示成破折号", () => {
    expect(formatMoneyList(format, [], "USD")).toBe("—");
  });

  test("同一种货币的两种写法合并成一条，不拆行", () => {
    expect(
      formatMoneyList(
        format,
        [
          { currency: "usd", amount: 500 },
          { currency: "USD", amount: 700 },
        ],
        "USD",
      ),
    ).toBe("$12");
  });

  test("不同币种按金额从大到小排", () => {
    expect(
      formatMoneyList(
        format,
        [
          { currency: "USDC", amount: 100 },
          { currency: null, amount: 900 },
        ],
        "USD",
      ),
    ).toBe("$9 · 1 USDC");
  });
});
