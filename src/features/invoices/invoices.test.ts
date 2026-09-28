import { describe, expect, test } from "vitest";

import {
  AMOUNT_MAX_CENTS,
  CUSTOMER_NAME_MAX,
  centsToInput,
  parseAmountToCents,
  parseInvoiceForm,
} from "./invoices";

// 示例模块的纯逻辑：金额解析 + 表单校验。两个弹层和 Server Action 都走这里，
// 所以这层锁住了，别的层不用重复测非法输入。

describe("parseAmountToCents", () => {
  test.each([
    ["1250", 125000],
    ["1250.5", 125050],
    ["1250.05", 125005],
    // 千分位逗号是给人看的，去掉即可。
    ["1,250.00", 125000],
    [" 19.99 ", 1999],
    ["0.01", 1],
    // 上限正好收下；再多一分就拒绝（integer 列存不下，也不该让人填）。
    ["1000000", AMOUNT_MAX_CENTS],
  ])("%s → %s 分", (value, cents) => {
    expect(parseAmountToCents(value)).toBe(cents);
  });

  test.each([
    ["", "空"],
    ["0", "零"],
    ["0.00", "零"],
    ["-1", "负数"],
    ["19.999", "三位小数"],
    ["1.2.3", "两个小数点"],
    ["1e3", "科学计数法"],
    ["１２３", "全角数字"],
    ["12 34", "中间有空格"],
    ["1000000.01", "超过上限"],
  ])("%s → null（%s）", (value) => {
    expect(parseAmountToCents(value)).toBeNull();
  });

  test.each([null, undefined, 1250, {}, [], true])(
    "非字符串 %o → null，不抛异常",
    (value) => {
      expect(parseAmountToCents(value)).toBeNull();
    },
  );

  test("不用浮点乘法：19.99 是 1999 分，不是 1998.99…", () => {
    expect(parseAmountToCents("19.99")).toBe(1999);
    expect(Number("19.99") * 100).not.toBe(1999);
  });
});

describe("centsToInput", () => {
  test.each([
    [125000, "1250.00"],
    [1999, "19.99"],
    [1, "0.01"],
    [0, "0.00"],
  ])("%s 分 → %s", (cents, text) => {
    expect(centsToInput(cents)).toBe(text);
  });

  test("回填出来的一定能再解析回同一个数（编辑 → 保存不该改掉金额）", () => {
    for (const cents of [1, 1999, 125000, AMOUNT_MAX_CENTS]) {
      expect(parseAmountToCents(centsToInput(cents))).toBe(cents);
    }
  });
});

/** 造一份表单数据；传 undefined 的字段就是不填。 */
function form(fields: Record<string, string | undefined>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) data.set(key, value);
  }
  return data;
}

const valid = {
  customerName: "Acme Inc.",
  amount: "1250.00",
  status: "draft",
};

describe("parseInvoiceForm", () => {
  test("合法表单：客户名 trim、金额换算成分", () => {
    expect(
      parseInvoiceForm(form({ ...valid, customerName: "  Acme Inc.  " })),
    ).toEqual({
      ok: true,
      data: { customerName: "Acme Inc.", amount: 125000, status: "draft" },
    });
  });

  test.each([
    ["空客户名", { ...valid, customerName: "   " }],
    [
      "客户名过长",
      { ...valid, customerName: "A".repeat(CUSTOMER_NAME_MAX + 1) },
    ],
    ["缺客户名", { ...valid, customerName: undefined }],
    ["金额非法", { ...valid, amount: "0" }],
    ["金额缺失", { ...valid, amount: undefined }],
    ["状态不在枚举里", { ...valid, status: "cancelled" }],
    ["状态缺失", { ...valid, status: undefined }],
  ])("%s → 不通过", (_name, fields) => {
    expect(parseInvoiceForm(form(fields))).toEqual({ ok: false });
  });

  test("客户名正好在上限内", () => {
    const parsed = parseInvoiceForm(
      form({ ...valid, customerName: "A".repeat(CUSTOMER_NAME_MAX) }),
    );
    expect(parsed.ok).toBe(true);
  });
});
