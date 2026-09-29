import { describe, expect, test } from "vitest";

import { revenueEnabled } from "./sections";

/** Only the fields the check uses; the rest is unused (the signature only takes plans anyway). */
const withPrices = (...prices: number[]) => ({
  plans: prices.map((price) => ({ price })),
});

describe("revenue section visibility", () => {
  // On a free deployment revenue is always 0 / "—" and shouldn't take up space (see the "Admin"
  // section of the README).
  test("hidden when there are only free plans", () => {
    expect(revenueEnabled(withPrices(0))).toBe(false);
    expect(revenueEnabled(withPrices(0, 0))).toBe(false);
  });

  test("hidden when there are no plans", () => {
    expect(revenueEnabled(withPrices())).toBe(false);
  });

  test("shown when there's any paid plan", () => {
    expect(revenueEnabled(withPrices(0, 900))).toBe(true);
    expect(revenueEnabled(withPrices(2900))).toBe(true);
  });
});
