import { describe, expect, test } from "vitest";

import { displayCurrency, formatMoney, formatMoneyList } from "./money";

/** Same shape as next-intl's getFormatter(): passes straight through to Intl.NumberFormat. */
const format = {
  number: (value: number, options?: Intl.NumberFormatOptions) =>
    new Intl.NumberFormat("en-US", options).format(value),
};

describe("currency normalization", () => {
  test("NULL and blank use the fallback currency; everything is uppercased", () => {
    expect(displayCurrency(null, "USD")).toBe("USD");
    expect(displayCurrency("", "usd")).toBe("USD");
    expect(displayCurrency("  ", "USD")).toBe("USD");
    expect(displayCurrency("usd", "USD")).toBe("USD");
  });

  test("stays empty without a fallback", () => {
    expect(displayCurrency(null, null)).toBeNull();
  });
});

describe("amount formatting", () => {
  test("a NULL currency uses the fallback currency instead of a bare number", () => {
    expect(formatMoney(format, 1250, null, "USD")).toBe("$12.50");
  });

  test("lowercase and uppercase codes are the same currency", () => {
    expect(formatMoney(format, 1250, "usd", "USD")).toBe(
      formatMoney(format, 1250, "USD", "USD"),
    );
  });

  // orders.currency is a free-text column: bad data must not 500 the whole page (Intl throws
  // RangeError on invalid currencies). Without a currency symbol the number is kept as is:
  // `maximumFractionDigits: 2` doesn't pad zeros (12.5, not 12.50).
  test('an invalid currency falls back to "number + raw code" without throwing', () => {
    expect(formatMoney(format, 1250, "USDC", "USD")).toBe("12.5 USDC");
    expect(formatMoney(format, 1250, "US dollar", null)).toBe("12.5 US DOLLAR");
  });

  test("shows only the number when there's no fallback currency", () => {
    expect(formatMoney(format, 1250, null, null)).toBe("12.5");
  });

  test("whole amounts have no decimals", () => {
    expect(formatMoney(format, 1200, "USD", "USD")).toBe("$12");
    expect(formatMoney(format, 1200, "USDC", null)).toBe("12 USDC");
  });
});

describe("multiple currencies in one cell", () => {
  test("empty shows as a dash", () => {
    expect(formatMoneyList(format, [], "USD")).toBe("—");
  });

  test("two spellings of the same currency merge into one entry", () => {
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

  test("different currencies are sorted by amount, largest first", () => {
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
