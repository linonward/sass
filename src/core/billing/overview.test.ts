import { describe, expect, test } from "vitest";

import { planSummary } from "./overview";

const free = { price: 0 };
const lifetime = { price: 199 };
const subscription = {
  planId: "pro",
  status: "active" as const,
  currentPeriodEnd: null,
  canceledAt: null,
};

describe("planSummary", () => {
  test("a subscription wins over one-time purchases", () => {
    expect(
      planSummary({ subscription, purchasedPlanIds: ["lifetime"] }, [free]),
    ).toBe("subscription");
  });

  test("a one-time buyer without a subscription is not told they're on the free plan", () => {
    expect(
      planSummary({ subscription: null, purchasedPlanIds: ["lifetime"] }, [
        free,
        lifetime,
      ]),
    ).toBe("purchased");
  });

  test("with nothing bought, the free plan is mentioned only when it's listed", () => {
    const nothing = { subscription: null, purchasedPlanIds: [] };
    expect(planSummary(nothing, [free, lifetime])).toBe("free");
    expect(planSummary(nothing, [lifetime])).toBe("none");
  });
});
