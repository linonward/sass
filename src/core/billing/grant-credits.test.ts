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
  test("一次性购买：按订单发放", () => {
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

  test("订阅的结账和激活不发放（由账期付款发放）", () => {
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

  test("订阅账期：按订阅 + 账期开始时间发放", () => {
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

  test("没有账期信息时退回用付款的订单 ID", () => {
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

  test("未知套餐、免费套餐或退款不发放", () => {
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
