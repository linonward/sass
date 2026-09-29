// @vitest-environment node
import { createHmac } from "node:crypto";

import { APIError } from "creem/models/errors";
import { describe, expect, test, vi } from "vitest";

import siteConfig from "../../../../site.config";
import { WebhookVerificationError } from "../provider";
import {
  creemSample,
  type CreemSampleEvent,
} from "./__fixtures__/creem-webhooks";
import {
  createCreemProvider,
  parseCreemEvent,
  type CreemClient,
} from "./creem";

const SECRET = "whsec_test_secret";

function signedRequest(
  body: string,
  signature = createHmac("sha256", SECRET).update(body).digest("hex"),
) {
  return new Request("https://example.test/api/webhooks/creem", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(signature !== "" && { "creem-signature": signature }),
    },
    body,
  });
}

function fakeClient(overrides: Partial<Record<string, unknown>> = {}) {
  const client = {
    checkouts: {
      create: vi.fn(async () => ({
        id: "ch_1",
        checkoutUrl: "https://checkout.creem.io/ch_1",
      })),
    },
    customers: {
      generateBillingLinks: vi.fn(async () => ({
        customerPortalLink: "https://creem.io/portal/cust_1",
      })),
    },
    subscriptions: {
      get: vi.fn(async () => ({ status: "active" })),
      cancel: vi.fn(async () => ({ status: "canceled" })),
    },
    ...overrides,
  };
  return client as unknown as CreemClient & typeof client;
}

const provider = (client = fakeClient()) =>
  createCreemProvider({
    apiKey: "creem_test_key",
    webhookSecret: SECRET,
    mode: "test",
    client,
  });

function apiError(status: number) {
  return new APIError("creem error", {
    response: new Response("{}", { status }),
    request: new Request("https://test-api.creem.io/v1/subscriptions"),
    body: "{}",
  });
}

describe("verifyWebhook", () => {
  const body = JSON.stringify(creemSample("checkout.completed"));

  test("returns the parsed body when the signature is valid", async () => {
    await expect(
      provider().verifyWebhook(signedRequest(body)),
    ).resolves.toEqual(JSON.parse(body));
  });

  test("rejects a wrong signature", async () => {
    await expect(
      provider().verifyWebhook(signedRequest(body, "0".repeat(64))),
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  test("rejects a missing signature header", async () => {
    await expect(
      provider().verifyWebhook(signedRequest(body, "")),
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  test("rejects a tampered body", async () => {
    const signature = createHmac("sha256", SECRET).update(body).digest("hex");
    const tampered = body.replace('"amount":1000', '"amount":1');
    expect(tampered).not.toBe(body);
    await expect(
      provider().verifyWebhook(signedRequest(tampered, signature)),
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  test("rejects a body signed with a different secret", async () => {
    const signature = createHmac("sha256", "other").update(body).digest("hex");
    await expect(
      provider().verifyWebhook(signedRequest(body, signature)),
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });
});

describe("parseCreemEvent: mapping of the official sample payloads", () => {
  test("checkout.completed (subscription checkout): no order, carries subscription and customer", () => {
    const sample = creemSample("checkout.completed");
    sample.object.metadata = { userId: "user_1", planId: "pro" };
    expect(parseCreemEvent(sample)).toMatchObject({
      type: "checkout.completed",
      provider: "creem",
      eventId: "evt_5WHHcZPv7VS0YUsberIuOz",
      occurredAt: new Date(1728734325927),
      userId: "user_1",
      planId: "pro",
      customerId: "cust_1OcIK1GEuVvXZwD19tjq2z",
      checkoutId: "ch_4l0N34kxo16AhRKUHFUuXr",
      subscriptionId: "sub_6pC2lNB6joCRQIZ1aMrTpi",
      orderId: undefined,
      amount: 1000,
      currency: "EUR",
    });
  });

  test("checkout.completed (one-time purchase): records the order", () => {
    const sample = creemSample("checkout.completed");
    delete sample.object.subscription;
    expect(parseCreemEvent(sample)).toMatchObject({
      type: "checkout.completed",
      orderId: "ord_4aDwWXjMLpes4Kj4XqNnUA",
      subscriptionId: undefined,
    });
  });

  test("without metadata.planId, looks up the plan by product ID and leaves it empty if not found", () => {
    const sample = creemSample("checkout.completed");
    expect(parseCreemEvent(sample)).toMatchObject({
      userId: undefined,
      planId: undefined,
    });
  });

  test("subscription.paid → subscription.renewed, with billing period and transaction ID", () => {
    expect(parseCreemEvent(creemSample("subscription.paid"))).toMatchObject({
      type: "subscription.renewed",
      subscriptionId: "sub_6pC2lNB6joCRQIZ1aMrTpi",
      customerId: "cust_1OcIK1GEuVvXZwD19tjq2z",
      orderId: "tran_5yMaWzAl3jxuGJMCOrYWwk",
      currentPeriodStart: new Date("2024-10-12T11:58:38.000Z"),
      currentPeriodEnd: new Date("2024-11-12T11:58:38.000Z"),
      amount: 1000,
      currency: "EUR",
    });
  });

  test.each<[CreemSampleEvent, string]>([
    ["subscription.active", "subscription.active"],
    ["subscription.update", "subscription.active"],
    ["subscription.canceled", "subscription.canceled"],
    ["subscription.scheduled_cancel", "subscription.canceled"],
    ["subscription.expired", "subscription.expired"],
    ["subscription.past_due", "payment.failed"],
    ["subscription.unpaid", "payment.failed"],
  ])("%s → %s", (sample, type) => {
    const event = parseCreemEvent(creemSample(sample));
    expect(event).toMatchObject({ type, provider: "creem" });
    expect(event).toHaveProperty("subscriptionId");
  });

  test("scheduled_cancel carries the time access lasts until", () => {
    expect(
      parseCreemEvent(creemSample("subscription.scheduled_cancel")),
    ).toMatchObject({
      type: "subscription.canceled",
      currentPeriodEnd: new Date("2024-11-12T11:58:38.000Z"),
    });
  });

  test("ignores subscription.update when not active", () => {
    const sample = creemSample("subscription.update");
    sample.object.status = "paused";
    expect(parseCreemEvent(sample)).toBeNull();
  });

  test("refund.created (subscription payment): maps to the order by transaction ID", () => {
    expect(parseCreemEvent(creemSample("refund.created"))).toMatchObject({
      type: "refund.created",
      refundId: "ref_3DB9NQFvk18TJwSqd0N6bd",
      orderId: "tran_5yMaWzAl3jxuGJMCOrYWwk",
      amount: 1210,
      currency: "EUR",
      customerId: "cust_1OcIK1GEuVvXZwD19tjq2z",
    });
  });

  test("refund.created (one-time purchase): uses the order ID", () => {
    const sample = creemSample("refund.created");
    const transaction = sample.object.transaction as Record<string, unknown>;
    delete transaction.subscription;
    delete sample.object.subscription;
    expect(parseCreemEvent(sample)).toMatchObject({
      orderId: "ord_4aDwWXjMLpes4Kj4XqNnUA",
    });
  });

  test("refund reads userId from the checkout metadata", () => {
    const sample = creemSample("refund.created");
    (sample.object.checkout as Record<string, unknown>).metadata = {
      userId: "user_9",
    };
    expect(parseCreemEvent(sample)).toMatchObject({ userId: "user_9" });
  });

  test.each<CreemSampleEvent>(["dispute.created", "subscription.trialing"])(
    "returns null for the ignored event %s",
    (sample) => {
      expect(parseCreemEvent(creemSample(sample))).toBeNull();
    },
  );

  test("returns null for a malformed body", () => {
    expect(parseCreemEvent(null)).toBeNull();
    expect(parseCreemEvent({ eventType: "checkout.completed" })).toBeNull();
  });
});

describe("createCheckout", () => {
  test("passes the product ID, return URL, email, and metadata", async () => {
    const client = fakeClient();
    const checkout = await provider(client).createCheckout({
      userId: "user_1",
      planId: "pro",
      successUrl: "https://example.com/dashboard?checkout=success",
      cancelUrl: "https://example.com/#pricing",
      customerEmail: "a@example.com",
    });
    expect(checkout).toEqual({
      checkoutId: "ch_1",
      url: "https://checkout.creem.io/ch_1",
    });
    const pro = siteConfig.billing.plans.find((p) => p.id === "pro");
    expect(client.checkouts.create).toHaveBeenCalledWith({
      productId: pro?.providerProductId,
      requestId: "user_1:pro",
      successUrl: "https://example.com/dashboard?checkout=success",
      customer: { email: "a@example.com" },
      metadata: { userId: "user_1", planId: "pro" },
    });
  });

  test("throws when the plan has no product ID", async () => {
    await expect(
      provider().createCheckout({
        userId: "user_1",
        planId: "free",
        successUrl: "https://x.test",
        cancelUrl: "https://x.test",
      }),
    ).rejects.toThrow(/providerProductId/);
  });
});

describe("cancelSubscription", () => {
  test("active subscription: cancels immediately", async () => {
    const client = fakeClient();
    await provider(client).cancelSubscription("sub_1");
    expect(client.subscriptions.cancel).toHaveBeenCalledWith("sub_1", {
      mode: "immediate",
    });
  });

  test.each(["canceled", "scheduled_cancel"])(
    "already %s: skips canceling and counts as success",
    async (status) => {
      const client = fakeClient();
      client.subscriptions.get.mockResolvedValueOnce({ status });
      await provider(client).cancelSubscription("sub_1");
      expect(client.subscriptions.cancel).not.toHaveBeenCalled();
    },
  );

  test("subscription not found (404): counts as success", async () => {
    const client = fakeClient();
    client.subscriptions.get.mockRejectedValueOnce(apiError(404));
    await expect(
      provider(client).cancelSubscription("sub_1"),
    ).resolves.toBeUndefined();
  });

  test("other errors: rethrown", async () => {
    const client = fakeClient();
    client.subscriptions.cancel.mockRejectedValueOnce(apiError(500));
    await expect(
      provider(client).cancelSubscription("sub_1"),
    ).rejects.toThrow();
  });
});

test("getPortalUrl returns the customer portal link", async () => {
  const client = fakeClient();
  await expect(provider(client).getPortalUrl("cust_1")).resolves.toBe(
    "https://creem.io/portal/cust_1",
  );
  expect(client.customers.generateBillingLinks).toHaveBeenCalledWith({
    customerId: "cust_1",
  });
});
