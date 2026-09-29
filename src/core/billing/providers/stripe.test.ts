// @vitest-environment node
// stripe-node's webhooks / errors need node:crypto (not available under jsdom).
import Stripe from "stripe";
import { describe, expect, test, vi } from "vitest";

import siteConfig from "../../../../site.config";
import { WebhookVerificationError } from "../provider";
import { stripeSample } from "./__fixtures__/stripe-webhooks";
import {
  createStripeProvider,
  parseStripeEvent,
  type StripeClient,
} from "./stripe";

const SECRET = "whsec_test_secret";
const PAYLOAD = JSON.stringify(
  stripeSample("checkout.session.completed.payment"),
);

/**
 * Use the real SDK for webhooks / errors: signature verification and error type checks really
 * run (offline, no network); only the three API calls are faked.
 */
const sdk = new Stripe("sk_test_unit");

function fakeClient() {
  const client = {
    checkout: {
      sessions: {
        // Return type widened to string | null so tests can simulate the provider returning no URL.
        create: vi.fn(
          async (): Promise<{ id: string; url: string | null }> => ({
            id: "cs_test_1",
            url: "https://checkout.stripe.com/c/pay/cs_test_1",
          }),
        ),
      },
    },
    billingPortal: {
      sessions: {
        create: vi.fn(async () => ({
          url: "https://billing.stripe.com/p/session_1",
        })),
      },
    },
    subscriptions: {
      retrieve: vi.fn(async (): Promise<{ status: string }> => ({
        status: "active",
      })),
      cancel: vi.fn(async () => ({ status: "canceled" })),
    },
    webhooks: sdk.webhooks,
    errors: sdk.errors,
  };
  return client as unknown as StripeClient & typeof client;
}

const provider = (client = fakeClient()) =>
  createStripeProvider({
    secretKey: "sk_test_unit",
    webhookSecret: SECRET,
    client,
  });

/**
 * Signs a request with the SDK's built-in signing helper (equivalent to the Stripe-Signature
 * header Stripe sends). Needs nothing besides the secret, so tests run offline.
 */
function signedRequest(
  body: string,
  signature = sdk.webhooks.generateTestHeaderString({
    payload: body,
    secret: SECRET,
  }),
) {
  return new Request("https://example.test/api/webhooks/stripe", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(signature !== "" && { "stripe-signature": signature }),
    },
    body,
  });
}

function apiError(status: number) {
  return new sdk.errors.StripeInvalidRequestError({
    message: "stripe error",
    type: "invalid_request_error",
    statusCode: status,
  });
}

describe("verifyWebhook", () => {
  test("returns the parsed body when the signature is valid", async () => {
    await expect(
      provider().verifyWebhook(signedRequest(PAYLOAD)),
    ).resolves.toEqual(JSON.parse(PAYLOAD));
  });

  test("rejects a wrong signature", async () => {
    await expect(
      provider().verifyWebhook(
        signedRequest(
          PAYLOAD,
          sdk.webhooks.generateTestHeaderString({
            payload: PAYLOAD,
            secret: "whsec_other",
          }),
        ),
      ),
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  test("rejects a missing signature header", async () => {
    await expect(
      provider().verifyWebhook(signedRequest(PAYLOAD, "")),
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  test("rejects a tampered body", async () => {
    const signature = sdk.webhooks.generateTestHeaderString({
      payload: PAYLOAD,
      secret: SECRET,
    });
    const tampered = PAYLOAD.replace(
      '"amount_total":19900',
      '"amount_total":1',
    );
    expect(tampered).not.toBe(PAYLOAD);
    await expect(
      provider().verifyWebhook(signedRequest(tampered, signature)),
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  test("rejects an expired signature (300-second tolerance window)", async () => {
    const old = Math.floor(Date.now() / 1000) - 3600;
    await expect(
      provider().verifyWebhook(
        signedRequest(
          PAYLOAD,
          sdk.webhooks.generateTestHeaderString({
            payload: PAYLOAD,
            secret: SECRET,
            timestamp: old,
          }),
        ),
      ),
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  test("rejects a valid signature over a body that isn't valid JSON", async () => {
    await expect(
      provider().verifyWebhook(signedRequest("{not json")),
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });
});

describe("parseStripeEvent: mapping of the official sample payloads", () => {
  test("checkout.session.completed (one-time payment): records the order, using the PaymentIntent as the order number", () => {
    expect(
      parseStripeEvent(stripeSample("checkout.session.completed.payment")),
    ).toMatchObject({
      type: "checkout.completed",
      provider: "stripe",
      eventId: "evt_1MtwBwLkdIwHu7ixrBB4xk2L",
      occurredAt: new Date(1679600215 * 1000),
      userId: "user_1",
      planId: "lifetime",
      customerId: "cus_NeZwdNtLEOXuvB",
      checkoutId:
        "cs_test_a11YYufWQzNY63zpQ6QSNRQhkUpVph4WRmzW0zWJO2znZKdVujZ0N0S22u",
      orderId: "pi_3MtwBwLkdIwHu7ix28a3tqPa",
      subscriptionId: undefined,
      amount: 19900,
      currency: "usd",
    });
  });

  test("checkout.session.completed (subscription): no order, the money is recorded by invoice.paid", () => {
    expect(
      parseStripeEvent(stripeSample("checkout.session.completed.subscription")),
    ).toMatchObject({
      type: "checkout.completed",
      planId: "pro",
      subscriptionId: "sub_1MowQVLkdIwHu7ixeRlqHVzs",
      orderId: undefined,
      amount: undefined,
      currency: undefined,
    });
  });

  test("treats a missing mode as a one-time payment (falls back to the checkout session ID without a PaymentIntent)", () => {
    const sample = stripeSample("checkout.session.completed.payment");
    delete sample.data.object.mode;
    delete sample.data.object.payment_intent;
    expect(parseStripeEvent(sample)).toMatchObject({
      orderId:
        "cs_test_a11YYufWQzNY63zpQ6QSNRQhkUpVph4WRmzW0zWJO2znZKdVujZ0N0S22u",
    });
  });

  test("invoice.paid → subscription.renewed, service period from the invoice line", () => {
    expect(parseStripeEvent(stripeSample("invoice.paid"))).toMatchObject({
      type: "subscription.renewed",
      provider: "stripe",
      eventId: "evt_1MtwBwLkdIwHu7ixuzkSPfKd",
      userId: "user_1",
      planId: "pro",
      customerId: "cus_Na6dX7aXxi11N4",
      subscriptionId: "sub_1MowQVLkdIwHu7ixeRlqHVzs",
      orderId: "in_1MowQWLkdIwHu7ixuzkSPfKd",
      currentPeriodStart: new Date(1679609767 * 1000),
      currentPeriodEnd: new Date(1682288167 * 1000),
      amount: 1900,
      currency: "usd",
    });
  });

  test("service period prefers the invoice line: invoice.period_* is only a fallback", () => {
    const sample = stripeSample("invoice.paid");
    const invoice = sample.data.object as {
      period_start: number;
      period_end: number;
      lines: { data: Array<{ period: { start: number; end: number } }> };
    };
    // The invoice-level period is "the time range in which invoice items can be associated", which
    // can differ from the service period.
    invoice.period_start = 1;
    invoice.period_end = 2;
    const firstLine = invoice.lines.data[0];
    if (!firstLine) throw new Error("fixture needs at least one invoice line");
    firstLine.period = { start: 1679609767, end: 1682288167 };
    expect(parseStripeEvent(sample)).toMatchObject({
      currentPeriodStart: new Date(1679609767 * 1000),
      currentPeriodEnd: new Date(1682288167 * 1000),
    });
    // Fall back to the invoice's period_* only when there are no invoice lines.
    invoice.lines.data = [];
    expect(parseStripeEvent(sample)).toMatchObject({
      currentPeriodStart: new Date(1000),
      currentPeriodEnd: new Date(2000),
    });
  });

  test("without metadata, looks up the plan by the invoice line's Price ID", () => {
    const sample = stripeSample("invoice.paid");
    const parent = (
      sample.data.object as {
        parent: { subscription_details: { metadata: Record<string, unknown> } };
      }
    ).parent;
    parent.subscription_details.metadata = {};
    const pro = siteConfig.billing.plans.find((plan) => plan.id === "pro");
    const priceLine = (
      sample.data.object as {
        lines: {
          data: Array<{ pricing: { price_details: { price: string } } }>;
        };
      }
    ).lines.data[0];
    if (!priceLine) throw new Error("fixture needs at least one invoice line");
    priceLine.pricing.price_details.price =
      pro?.providerProductId ?? "price_unknown";
    expect(parseStripeEvent(sample)).toMatchObject({ planId: "pro" });
    // With no metadata and an unknown Price ID, it can only be empty.
    const unknown = stripeSample("invoice.paid");
    const unknownParent = (
      unknown.data.object as {
        parent: { subscription_details: { metadata: Record<string, unknown> } };
      }
    ).parent;
    unknownParent.subscription_details.metadata = {};
    expect(parseStripeEvent(unknown)).toMatchObject({ planId: undefined });
  });

  test("invoice.payment_failed → payment.failed, the order number is also the invoice ID (a successful retry merges into one order)", () => {
    expect(
      parseStripeEvent(stripeSample("invoice.payment_failed")),
    ).toMatchObject({
      type: "payment.failed",
      subscriptionId: "sub_1MowQVLkdIwHu7ixeRlqHVzs",
      orderId: "in_1MowQWLkdIwHu7ixuzkSPfKd",
      amount: 1900,
      currency: "usd",
    });
  });

  test("ignores invoices whose parent is not a subscription (one-off invoices)", () => {
    for (const parent of [
      null,
      { type: "quote_details", quote_details: { quote: "qt_1" } },
    ]) {
      const sample = stripeSample("invoice.paid");
      (sample.data.object as { parent: unknown }).parent = parent;
      expect(parseStripeEvent(sample)).toBeNull();
    }
  });

  test.each<[string, string]>([
    ["active", "subscription.active"],
    ["trialing", "subscription.active"],
    ["past_due", "payment.failed"],
    ["unpaid", "payment.failed"],
    ["canceled", "subscription.canceled"],
  ])("customer.subscription.updated（status=%s）→ %s", (status, type) => {
    const sample = stripeSample("customer.subscription.updated");
    (sample.data.object as { status: string }).status = status;
    const event = parseStripeEvent(sample);
    expect(event).toMatchObject({ type, provider: "stripe" });
    expect(event).toHaveProperty(
      "subscriptionId",
      "sub_1MowQVLkdIwHu7ixeRlqHVzs",
    );
  });

  test("active carries the billing period and plan (the period is on the subscription item, not the subscription)", () => {
    expect(
      parseStripeEvent(stripeSample("customer.subscription.updated")),
    ).toMatchObject({
      type: "subscription.active",
      planId: "pro",
      userId: "user_1",
      currentPeriodStart: new Date(1679609767 * 1000),
      currentPeriodEnd: new Date(1682288167 * 1000),
    });
  });

  test("scheduled cancel at period end is treated as canceled, with the time access lasts until", () => {
    const sample = stripeSample("customer.subscription.updated");
    (
      sample.data.object as { cancel_at_period_end: boolean }
    ).cancel_at_period_end = true;
    expect(parseStripeEvent(sample)).toMatchObject({
      type: "subscription.canceled",
      currentPeriodEnd: new Date(1682288167 * 1000),
    });
  });

  test("past_due carries no order number: the order is recorded by invoice.payment_failed", () => {
    const sample = stripeSample("customer.subscription.updated");
    (sample.data.object as { status: string }).status = "past_due";
    expect(parseStripeEvent(sample)).not.toHaveProperty("orderId");
  });

  test("customer.subscription.deleted → subscription.expired", () => {
    expect(
      parseStripeEvent(stripeSample("customer.subscription.deleted")),
    ).toMatchObject({
      type: "subscription.expired",
      subscriptionId: "sub_1MowQVLkdIwHu7ixeRlqHVzs",
      userId: "user_1",
    });
  });

  test.each(["incomplete", "incomplete_expired", "paused", "weird_status"])(
    "customer.subscription.updated with status %s is not handled",
    (status) => {
      const sample = stripeSample("customer.subscription.updated");
      (sample.data.object as { status: string }).status = status;
      expect(parseStripeEvent(sample)).toBeNull();
    },
  );

  test("ignores refund events (not handled in v1, see the notes at the top of stripe.ts)", () => {
    expect(parseStripeEvent(stripeSample("charge.refunded"))).toBeNull();
  });

  test("returns null for a malformed body", () => {
    expect(parseStripeEvent(null)).toBeNull();
    expect(parseStripeEvent({ type: "invoice.paid" })).toBeNull();
    expect(parseStripeEvent({ id: "evt_1", type: "invoice.paid" })).toBeNull();
    expect(parseStripeEvent({ id: "evt_1", data: { object: {} } })).toBeNull();
    // Subscription events without an id are dropped too ((provider, eventId) is the idempotency
    // key).
    const noId = stripeSample("customer.subscription.deleted");
    delete noId.data.object.id;
    expect(parseStripeEvent(noId)).toBeNull();
  });

  test("raw keeps the original body", () => {
    const sample = stripeSample("invoice.paid");
    expect(parseStripeEvent(sample)?.raw).toEqual(sample);
  });
});

describe("createCheckout", () => {
  test("one-time purchase: mode=payment, no subscription_data", async () => {
    const client = fakeClient();
    const checkout = await provider(client).createCheckout({
      userId: "user_1",
      planId: "lifetime",
      successUrl: "https://example.com/dashboard?checkout=success",
      cancelUrl: "https://example.com/#pricing",
      customerEmail: "a@example.com",
    });
    expect(checkout).toEqual({
      checkoutId: "cs_test_1",
      url: "https://checkout.stripe.com/c/pay/cs_test_1",
    });
    const lifetime = siteConfig.billing.plans.find(
      (plan) => plan.id === "lifetime",
    );
    expect(client.checkout.sessions.create).toHaveBeenCalledWith({
      mode: "payment",
      line_items: [{ price: lifetime?.providerProductId, quantity: 1 }],
      success_url: "https://example.com/dashboard?checkout=success",
      cancel_url: "https://example.com/#pricing",
      client_reference_id: "user_1",
      metadata: { userId: "user_1", planId: "lifetime" },
      customer_email: "a@example.com",
    });
  });

  test("subscription: mode=subscription, metadata also written to the subscription", async () => {
    const client = fakeClient();
    await provider(client).createCheckout({
      userId: "user_1",
      planId: "pro",
      successUrl: "https://example.com/dashboard?checkout=success",
      cancelUrl: "https://example.com/#pricing",
    });
    const pro = siteConfig.billing.plans.find((plan) => plan.id === "pro");
    expect(client.checkout.sessions.create).toHaveBeenCalledWith({
      mode: "subscription",
      line_items: [{ price: pro?.providerProductId, quantity: 1 }],
      success_url: "https://example.com/dashboard?checkout=success",
      cancel_url: "https://example.com/#pricing",
      client_reference_id: "user_1",
      metadata: { userId: "user_1", planId: "pro" },
      // The Session's metadata isn't copied to the subscription; only
      // subscription_data.metadata is.
      subscription_data: { metadata: { userId: "user_1", planId: "pro" } },
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

  test("throws when the provider returns no URL", async () => {
    const client = fakeClient();
    client.checkout.sessions.create.mockResolvedValueOnce({
      id: "cs_test_2",
      url: null,
    });
    await expect(
      provider(client).createCheckout({
        userId: "user_1",
        planId: "pro",
        successUrl: "https://x.test",
        cancelUrl: "https://x.test",
      }),
    ).rejects.toThrow(/no url/);
  });
});

describe("cancelSubscription", () => {
  test("active subscription: cancels immediately", async () => {
    const client = fakeClient();
    await provider(client).cancelSubscription("sub_1");
    expect(client.subscriptions.cancel).toHaveBeenCalledWith("sub_1");
  });

  test.each(["canceled", "incomplete_expired"])(
    "already %s: skips canceling and counts as success",
    async (status) => {
      const client = fakeClient();
      client.subscriptions.retrieve.mockResolvedValueOnce({ status });
      await provider(client).cancelSubscription("sub_1");
      expect(client.subscriptions.cancel).not.toHaveBeenCalled();
    },
  );

  test.each(["active", "trialing", "past_due", "unpaid", "paused"])(
    "%s can still be canceled, so cancel is called as usual",
    async (status) => {
      const client = fakeClient();
      client.subscriptions.retrieve.mockResolvedValueOnce({ status });
      await provider(client).cancelSubscription("sub_1");
      expect(client.subscriptions.cancel).toHaveBeenCalledWith("sub_1");
    },
  );

  test("subscription not found (404): counts as success", async () => {
    const client = fakeClient();
    client.subscriptions.retrieve.mockRejectedValueOnce(apiError(404));
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

  test("rethrows non-Stripe errors", async () => {
    const client = fakeClient();
    client.subscriptions.retrieve.mockRejectedValueOnce(new Error("boom"));
    await expect(provider(client).cancelSubscription("sub_1")).rejects.toThrow(
      "boom",
    );
  });
});

test("getPortalUrl includes the return URL", async () => {
  const client = fakeClient();
  await expect(provider(client).getPortalUrl("cus_1")).resolves.toBe(
    "https://billing.stripe.com/p/session_1",
  );
  expect(client.billingPortal.sessions.create).toHaveBeenCalledWith({
    customer: "cus_1",
    // The return URL comes from the site's own domain (site.config.ts, overridable with
    // SITE_DOMAIN), so the assertion uses the same source instead of hard-coding a domain (CI uses
    // ci.example.test).
    return_url: `https://${siteConfig.domain}/billing`,
  });
});

test("provider.id is stripe, as used by the registry", () => {
  expect(provider().id).toBe("stripe");
});
