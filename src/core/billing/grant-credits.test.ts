import { describe, expect, test } from "vitest";

import type { BillingEvent } from "./events";
import { creditsForBillingEvent } from "./grant-credits";

const base = {
  provider: "creem",
  eventId: "evt_1",
  occurredAt: new Date(),
  raw: null,
};

describe("creditsForBillingEvent", () => {
  test("one-time purchase: granted per order", () => {
    const event: BillingEvent = {
      ...base,
      type: "checkout.completed",
      checkoutId: "ch_1",
      planId: "lifetime",
      orderId: "ord_1",
    };
    expect(creditsForBillingEvent(event)).toMatchObject({
      amount: 2000,
      sourceId: "creem:order:ord_1",
    });
  });

  test("subscription checkout and activation grant nothing (the billing-period payment does)", () => {
    expect(
      creditsForBillingEvent({
        ...base,
        type: "checkout.completed",
        checkoutId: "ch_1",
        planId: "pro",
        subscriptionId: "sub_1",
      }),
    ).toBeNull();
    expect(
      creditsForBillingEvent({
        ...base,
        type: "subscription.active",
        subscriptionId: "sub_1",
        planId: "pro",
      }),
    ).toBeNull();
  });

  test("subscription billing period: granted per subscription + period start", () => {
    expect(
      creditsForBillingEvent({
        ...base,
        type: "subscription.renewed",
        subscriptionId: "sub_1",
        planId: "pro",
        orderId: "tran_1",
        currentPeriodStart: new Date("2026-01-01T00:00:00Z"),
      }),
    ).toMatchObject({
      amount: 2000,
      sourceId: "creem:subscription:sub_1:2026-01-01T00:00:00.000Z",
    });
  });

  test("falls back to the payment's order ID when there is no billing period info", () => {
    expect(
      creditsForBillingEvent({
        ...base,
        type: "subscription.renewed",
        subscriptionId: "sub_1",
        planId: "pro",
        orderId: "tran_1",
      }),
    ).toMatchObject({ sourceId: "creem:order:tran_1" });
  });

  test("unknown plans, free plans and refunds grant nothing", () => {
    expect(
      creditsForBillingEvent({
        ...base,
        type: "checkout.completed",
        checkoutId: "ch_1",
        planId: "nope",
        orderId: "ord_1",
      }),
    ).toBeNull();
    expect(
      creditsForBillingEvent({
        ...base,
        type: "refund.created",
        orderId: "ord_1",
        refundId: "ref_1",
        amount: 100,
        currency: "USD",
      }),
    ).toBeNull();
  });
});
