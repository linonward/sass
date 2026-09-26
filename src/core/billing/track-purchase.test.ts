import { describe, expect, test, vi } from "vitest";

import type { BillingEvent } from "./events";
import type { AfterCommitCallback } from "./on-billing-event";
import { createPurchaseTrackingHandler } from "./track-purchase";

const base = {
  provider: "creem",
  eventId: "evt_1",
  occurredAt: new Date(),
  raw: null,
};

async function run(event: BillingEvent) {
  const track = vi.fn().mockResolvedValue(undefined);
  const callbacks: AfterCommitCallback[] = [];
  await createPurchaseTrackingHandler({ track })(event, {
    tx: {} as never,
    stale: false,
    userId: "user_1",
    afterCommit: (fn) => callbacks.push(fn),
  });
  // 事务提交之前不发送。
  expect(track).not.toHaveBeenCalled();
  for (const fn of callbacks) await fn();
  return track;
}

describe("createPurchaseTrackingHandler", () => {
  test("checkout.completed：提交后发 purchase，只带套餐 ID", async () => {
    const track = await run({
      ...base,
      type: "checkout.completed",
      checkoutId: "ch_1",
      planId: "pro",
      subscriptionId: "sub_1",
      amount: 1900,
      currency: "USD",
    });
    expect(track).toHaveBeenCalledExactlyOnceWith(
      "purchase",
      { plan: "pro" },
      // 没有访客上下文，不用 webhook 请求（服务商）的 headers。
      { headers: {} },
    );
  });

  test("没有套餐 ID 时 plan 为 null", async () => {
    const track = await run({
      ...base,
      type: "checkout.completed",
      checkoutId: "ch_1",
      orderId: "ord_1",
    });
    expect(track).toHaveBeenCalledWith(
      "purchase",
      { plan: null },
      { headers: {} },
    );
  });

  test("续费和其他事件不算转化", async () => {
    const track = await run({
      ...base,
      type: "subscription.renewed",
      subscriptionId: "sub_1",
      planId: "pro",
    });
    expect(track).not.toHaveBeenCalled();
  });
});
