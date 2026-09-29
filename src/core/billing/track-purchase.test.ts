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
  // Nothing is sent before the transaction commits.
  expect(track).not.toHaveBeenCalled();
  for (const fn of callbacks) await fn();
  return track;
}

describe("createPurchaseTrackingHandler", () => {
  test("checkout.completed: sends purchase after commit, with only the plan ID", async () => {
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
      // No visitor context; don't use the headers of the webhook request (from the provider).
      { headers: {} },
    );
  });

  test("plan is null when there is no plan ID", async () => {
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

  test("renewals and other events don't count as conversions", async () => {
    const track = await run({
      ...base,
      type: "subscription.renewed",
      subscriptionId: "sub_1",
      planId: "pro",
    });
    expect(track).not.toHaveBeenCalled();
  });
});
