import { z } from "zod";

import { invoiceStatuses } from "./schema";

// 示例业务模块：金额解析和表单校验。这里不 import Next / 数据库，纯逻辑便于单测；
// 碰数据库的在 ./queries.ts，写数据的在 ./actions.ts。

export const CUSTOMER_NAME_MAX = 120;

/** 金额上限（最小货币单位）：一亿分 = 100 万，挡住把 integer 列撑爆的输入。 */
export const AMOUNT_MAX_CENTS = 100_000_000;

/**
 * 人填的金额 → 最小货币单位（分）的整数。
 *
 * 接受 `1250`、`1250.5`、`1,250.00`；不接受负数、0、超过两位小数和任何别的字符。
 * 解析不了返回 null（由调用方转成表单错误），不抛异常 —— 用户输入不该让服务端 500。
 * 用字符串拼接算分，不做 `Number(x) * 100` 的浮点乘法（`19.99 * 100` 是 1998.9999…）。
 */
export function parseAmountToCents(value: unknown): number | null {
  if (typeof value !== "string") return null;
  // 千分位逗号只是给人看的，先去掉；其余字符一概不接受。
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim().replace(/,/g, ""));
  if (!match) return null;
  const cents =
    Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return cents > 0 && cents <= AMOUNT_MAX_CENTS ? cents : null;
}

/** 最小货币单位 → 表单里的金额文本（编辑时要回填成 `1250.00` 这种原样可改的值）。 */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * 新建/编辑表单的校验。三个字段一份 schema，创建和更新共用 ——
 * 两处各写一份的话，迟早一边接受空客户名、另一边不接受。
 */
export const invoiceFormSchema = z.object({
  customerName: z.string().trim().min(1).max(CUSTOMER_NAME_MAX),
  // 表单传进来的是字符串，校验通过后就是「分」。
  amount: z.unknown().transform((value, ctx) => {
    const cents = parseAmountToCents(value);
    if (cents === null) {
      ctx.addIssue({ code: "custom", message: "invalid_amount" });
      return z.NEVER;
    }
    return cents;
  }),
  status: z.enum(invoiceStatuses),
});

export type InvoiceInput = z.infer<typeof invoiceFormSchema>;

/** 解析表单。失败时只回一个标记：具体哪个字段错了由客户端按 native 校验和提示兜。 */
export function parseInvoiceForm(form: FormData) {
  const parsed = invoiceFormSchema.safeParse({
    customerName: form.get("customerName"),
    amount: form.get("amount"),
    status: form.get("status"),
  });
  return parsed.success
    ? ({ ok: true, data: parsed.data } as const)
    : ({ ok: false } as const);
}
