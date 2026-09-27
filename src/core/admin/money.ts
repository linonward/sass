/** 金额 + 币种。`orders.currency` 是自由文本列，历史数据里可能是 null、小写或非法取值。 */
export type CurrencyAmount = { currency: string | null; amount: number };

/**
 * next-intl 的 `getFormatter()` 里我们只用到 number，选项也只有这三个。
 *
 * 不写成 `Intl.NumberFormatOptions`：next-intl 走的是 formatjs 自己的同名类型
 * （`lib.es5` 的 DOM 版多认几个 `useGrouping` 取值），两边互相不兼容。
 * 这里只用最小的形状，两个来源都能传进来。
 */
type MoneyFormatOptions = {
  maximumFractionDigits?: number;
  style?: "currency";
  currency?: string;
};

type NumberFormatter = {
  number: (value: number, options?: MoneyFormatOptions) => string;
};

const wellFormed = /^[A-Za-z]{3}$/;

/**
 * 展示用币种：空值用兜底币种，其余统一大写。
 * 大写是为了让 `usd` 和 `USD` 归成同一种货币（报表按币种分组，不归一就会拆成两条）。
 */
export function displayCurrency(
  currency: string | null,
  fallback: string | null,
): string | null {
  const raw = currency?.trim() || fallback?.trim();
  return raw ? raw.toUpperCase() : null;
}

/**
 * 最小货币单位 → 可显示的金额。`fallback` 是没写币种时的兜底（后台两页都用
 * `site.config.ts` 的 `billing.currency`）。
 *
 * `Intl.NumberFormat` 对非法币种抛 RangeError（`USDC` 是 4 个字母，不在 ISO 4217 里），
 * 库里一条坏数据就能让整页 500 且不清掉就一直 500。这里退回「数字 + 原代码」：
 * 金额照常显示，也能一眼看出是哪个币种写坏了，不会被悄悄换成一个别的货币符号。
 */
export function formatMoney(
  format: NumberFormatter,
  amount: number,
  currency: string | null,
  fallback: string | null = null,
): string {
  const code = displayCurrency(currency, fallback);
  // 整数金额不写小数位：和落地页定价、llms.txt 同一条规则（金额是最小货币单位）。
  const digits = { maximumFractionDigits: amount % 100 === 0 ? 0 : 2 };
  if (code && wellFormed.test(code)) {
    try {
      return format.number(amount / 100, {
        ...digits,
        style: "currency",
        currency: code,
      });
    } catch {
      // 三个字母但不是已知货币：Intl 一般不抛，真抛了也走下面的兜底。
    }
  }
  const value = format.number(amount / 100, digits);
  return code ? `${value} ${code}` : value;
}

/**
 * 一格里的多个币种：同一种货币先合并（`usd` 和 `USD` 算一种），再按金额从大到小
 * 拼成一行。合并放在展示层，是为了不让同一笔收入因为大小写拆成两条。
 */
export function formatMoneyList(
  format: NumberFormatter,
  list: readonly CurrencyAmount[],
  fallback: string | null,
): string {
  if (list.length === 0) return "—";
  const merged = new Map<string, { code: string | null; amount: number }>();
  for (const row of list) {
    const code = displayCurrency(row.currency, fallback);
    const key = code ?? "";
    const entry = merged.get(key) ?? { code, amount: 0 };
    entry.amount += row.amount;
    merged.set(key, entry);
  }
  return [...merged.values()]
    .sort((a, b) => b.amount - a.amount)
    .map((entry) => formatMoney(format, entry.amount, entry.code, fallback))
    .join(" · ");
}
