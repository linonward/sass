/**
 * Amount + currency. `orders.currency` is a free-text column; historical data may hold null,
 * lowercase, or invalid values.
 */
export type CurrencyAmount = { currency: string | null; amount: number };

/**
 * From next-intl's `getFormatter()` we only use number, and only these three options.
 *
 * Not typed as `Intl.NumberFormatOptions`: next-intl uses formatjs's own type of the same name
 * (the DOM version in `lib.es5` accepts a few more `useGrouping` values), and the two aren't
 * compatible. Using only the minimal shape here lets both sources be passed in.
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
 * Display currency: empty values use the fallback currency; everything else is uppercased.
 * Uppercasing makes `usd` and `USD` the same currency (reports group by currency, and without
 * normalizing they'd split into two rows).
 */
export function displayCurrency(
  currency: string | null,
  fallback: string | null,
): string | null {
  const raw = currency?.trim() || fallback?.trim();
  return raw ? raw.toUpperCase() : null;
}

/**
 * Smallest currency unit → displayable amount. `fallback` is used when no currency is recorded
 * (both admin pages use `billing.currency` from `site.config.ts`).
 *
 * `Intl.NumberFormat` throws RangeError on invalid currencies (`USDC` has 4 letters and isn't in
 * ISO 4217), so a single bad row in the database would 500 the whole page until cleaned up. Here
 * we fall back to "number + raw code": the amount still shows, it's obvious at a glance which
 * currency is corrupt, and it isn't silently swapped for some other currency symbol.
 */
export function formatMoney(
  format: NumberFormatter,
  amount: number,
  currency: string | null,
  fallback: string | null = null,
): string {
  const code = displayCurrency(currency, fallback);
  // Whole amounts get no decimals: the same rule as landing page pricing and llms.txt (amounts
  // are in the smallest currency unit).
  const digits = { maximumFractionDigits: amount % 100 === 0 ? 0 : 2 };
  if (code && wellFormed.test(code)) {
    try {
      return format.number(amount / 100, {
        ...digits,
        style: "currency",
        currency: code,
      });
    } catch {
      // Three letters but not a known currency: Intl usually doesn't throw, and if it does, the
      // fallback below handles it.
    }
  }
  const value = format.number(amount / 100, digits);
  return code ? `${value} ${code}` : value;
}

/**
 * Multiple currencies in one cell: amounts in the same currency are merged first (`usd` and `USD`
 * count as one), then joined into one line from largest to smallest. Merging happens in the
 * display layer so the same revenue doesn't split into two entries over letter case.
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
