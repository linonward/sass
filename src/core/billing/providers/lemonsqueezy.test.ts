// @vitest-environment node
import { createHmac } from "node:crypto";

import { describe, expect, test, vi } from "vitest";

import siteConfig from "../../../../site.config";
import { WebhookVerificationError } from "../provider";
import {
  lemonSqueezySample,
  type LemonSqueezySampleEvent,
} from "./__fixtures__/lemonsqueezy-webhooks";
import {
  createLemonSqueezyProvider,
  parseLemonSqueezyEvent,
} from "./lemonsqueezy";
import {
  createLemonSqueezyClient,
  LemonSqueezyApiError,
  type LemonSqueezyFetch,
} from "./lemonsqueezy/client";

const SECRET = "ls_whsec_test_secret";
const STORE_ID = "12345";

/**
 * Product IDs from the site config (products for Creem, variants for Lemon Squeezy). CI overrides
 * them with env vars, so read them at runtime.
 */
function providerProductId(planId: string) {
  const plan = siteConfig.billing.plans.find((item) => item.id === planId);
  if (!plan?.providerProductId) throw new Error(`plan ${planId} has no id`);
  return plan.providerProductId;
}

function signedRequest(
  body: string,
  signature = createHmac("sha256", SECRET).update(body).digest("hex"),
) {
  return new Request("https://example.test/api/webhooks/lemonsqueezy", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(signature !== "" && { "X-Signature": signature }),
    },
    body,
  });
}

function fakeClient() {
  return { request: vi.fn() };
}

const provider = (client = fakeClient()) =>
  createLemonSqueezyProvider({
    apiKey: "ls_api_key",
    webhookSecret: SECRET,
    storeId: STORE_ID,
    client,
  });

/**
 * Injects the `checkout_data.custom` passed at checkout (in real deliveries it's in
 * meta.custom_data).
 */
function withCustomData(
  sample: ReturnType<typeof lemonSqueezySample>,
  custom: Record<string, unknown>,
) {
  sample.meta.custom_data = custom;
  return sample;
}

/**
 * The variant_id in the official examples is the docs' 1 / 2; swap in a variant ID from the site
 * config to hit the lookup branch.
 */
function withVariant(
  sample: ReturnType<typeof lemonSqueezySample>,
  variantId: unknown,
) {
  (
    sample.data.attributes.first_order_item as { variant_id: unknown }
  ).variant_id = variantId;
  return sample;
}

describe("verifyWebhook", () => {
  const body = JSON.stringify(lemonSqueezySample("order_created"));

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

  test("rejects a missing X-Signature", async () => {
    await expect(
      provider().verifyWebhook(signedRequest(body, "")),
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  test("rejects a tampered body", async () => {
    const signature = createHmac("sha256", SECRET).update(body).digest("hex");
    const tampered = body.replace('"status":"paid"', '"status":"refunded"');
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

  // timingSafeEqual throws a TypeError on buffers of different lengths, so lengths must be
  // compared first; this asserts we get a WebhookVerificationError (not that internal error).
  test("rejects a signature of the wrong length (without throwing TypeError)", async () => {
    await expect(
      provider().verifyWebhook(signedRequest(body, "abc")),
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  test("rejects a valid signature over a non-JSON body", async () => {
    await expect(
      provider().verifyWebhook(signedRequest("not json")),
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });
});

describe("HTTP client", () => {
  test("sends Bearer and the JSON:API media type, parses the JSON:API response", async () => {
    const fakeFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { id: "1" } }), { status: 200 }),
    ) as unknown as LemonSqueezyFetch;
    const client = createLemonSqueezyClient({
      apiKey: "ls_api_key",
      fetch: fakeFetch,
    });

    await expect(
      client.request("POST", "/v1/checkouts", { data: {} }),
    ).resolves.toEqual({ data: { id: "1" } });

    const [url, init] = (fakeFetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("https://api.lemonsqueezy.com/v1/checkouts");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer ls_api_key",
      Accept: "application/vnd.api+json",
      "Content-Type": "application/vnd.api+json",
    });
    expect(init.body).toBe(JSON.stringify({ data: {} }));
  });

  test("GET sends no Content-Type and no body", async () => {
    const fakeFetch = vi.fn(
      async () => new Response("{}", { status: 200 }),
    ) as unknown as LemonSqueezyFetch;
    await createLemonSqueezyClient({ apiKey: "k", fetch: fakeFetch }).request(
      "GET",
      "/v1/customers/1",
    );
    const [, init] = (fakeFetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [URL, RequestInit];
    expect(init.headers).not.toHaveProperty("Content-Type");
    expect(init.body).toBeUndefined();
  });

  test("throws on non-2xx, with the status code and a body snippet", async () => {
    const fakeFetch = vi.fn(
      async () =>
        new Response('{"errors":[{"detail":"nope"}]}', { status: 422 }),
    ) as unknown as LemonSqueezyFetch;
    const error = await createLemonSqueezyClient({
      apiKey: "k",
      fetch: fakeFetch,
    })
      .request("POST", "/v1/checkouts", {})
      .catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(LemonSqueezyApiError);
    expect((error as LemonSqueezyApiError).status).toBe(422);
    expect((error as LemonSqueezyApiError).message).toContain("nope");
  });

  // Not retrying is deliberate: checkout is triggered by a user click, and Lemon Squeezy
  // redelivers webhooks with its own backoff.
  test("no retry even on 429: sends the request only once", async () => {
    const fakeFetch = vi.fn(
      async () => new Response("slow down", { status: 429 }),
    ) as unknown as LemonSqueezyFetch;
    await expect(
      createLemonSqueezyClient({ apiKey: "k", fetch: fakeFetch }).request(
        "GET",
        "/v1/customers/1",
      ),
    ).rejects.toBeInstanceOf(LemonSqueezyApiError);
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });
});

describe("parseLemonSqueezyEvent: mapping of the official sample payloads", () => {
  test("order_created (variant maps to no plan): records the order as one-time", () => {
    expect(
      parseLemonSqueezyEvent(lemonSqueezySample("order_created")),
    ).toMatchObject({
      type: "checkout.completed",
      provider: "lemonsqueezy",
      eventId: "order_created:1:2023-01-17T12:26:23.000Z",
      occurredAt: new Date("2023-01-17T12:26:23.000Z"),
      checkoutId: "1",
      orderId: "1",
      customerId: "1",
      planId: undefined,
      // The official example's total is the decimal 1859.76 (the docs say integer cents), so it is
      // rounded as a fallback.
      amount: 1860,
      currency: "EUR",
    });
  });

  test("order_created (variant is a one-time plan): records the order and maps the plan", () => {
    const sample = withVariant(
      lemonSqueezySample("order_created"),
      providerProductId("lifetime"),
    );
    expect(parseLemonSqueezyEvent(sample)).toMatchObject({
      type: "checkout.completed",
      planId: "lifetime",
      orderId: "1",
    });
  });

  test("order_created (variant is a subscription plan): no order, the first period is recorded by the invoice event", () => {
    const sample = withVariant(
      lemonSqueezySample("order_created"),
      providerProductId("pro"),
    );
    expect(parseLemonSqueezyEvent(sample)).toMatchObject({
      type: "checkout.completed",
      planId: "pro",
      orderId: undefined,
    });
  });

  test("order_created: userId / planId in meta.custom_data win", () => {
    const sample = withCustomData(lemonSqueezySample("order_created"), {
      userId: "user_1",
      planId: "pro",
    });
    expect(parseLemonSqueezyEvent(sample)).toMatchObject({
      userId: "user_1",
      planId: "pro",
    });
  });

  test("subscription_created (on_trial) → subscription.active", () => {
    const sample = withCustomData(lemonSqueezySample("subscription_created"), {
      userId: "user_1",
    });
    expect(parseLemonSqueezyEvent(sample)).toMatchObject({
      type: "subscription.active",
      subscriptionId: "1",
      customerId: "2",
      userId: "user_1",
      currentPeriodEnd: new Date("2023-01-24T12:43:48.000Z"),
    });
  });

  test("subscription_created: the plan is found by variant", () => {
    const sample = lemonSqueezySample("subscription_created");
    sample.data.attributes.variant_id = providerProductId("pro");
    expect(parseLemonSqueezyEvent(sample)).toMatchObject({
      type: "subscription.active",
      planId: "pro",
    });
  });

  test.each<LemonSqueezySampleEvent>([
    "subscription_updated",
    "subscription_resumed",
    "subscription_unpaused",
  ])("%s (status=active) → subscription.active", (sample) => {
    expect(parseLemonSqueezyEvent(lemonSqueezySample(sample))).toMatchObject({
      type: "subscription.active",
      subscriptionId: "1",
      // The renewal time is after updated_at; both points must be present.
      currentPeriodStart: new Date("2023-01-17T12:43:50.000Z"),
      currentPeriodEnd: new Date("2023-01-24T12:43:48.000Z"),
    });
  });

  test("subscription_updated with cancelled status is treated as a cancellation (must not revive a canceled subscription)", () => {
    const sample = lemonSqueezySample("subscription_created");
    sample.meta.event_name = "subscription_updated";
    sample.data.attributes.status = "cancelled";
    sample.data.attributes.ends_at = "2023-02-17T14:15:43.000000Z";
    expect(parseLemonSqueezyEvent(sample)).toMatchObject({
      type: "subscription.canceled",
      currentPeriodEnd: new Date("2023-02-17T14:15:43.000Z"),
    });
  });

  test("subscription_cancelled → subscription.canceled, with ends_at as the time access lasts until", () => {
    expect(
      parseLemonSqueezyEvent(lemonSqueezySample("subscription_cancelled")),
    ).toMatchObject({
      type: "subscription.canceled",
      subscriptionId: "3",
      customerId: "2",
      currentPeriodEnd: new Date("2023-02-17T14:15:43.000Z"),
    });
  });

  test("subscription_expired → subscription.expired", () => {
    expect(
      parseLemonSqueezyEvent(lemonSqueezySample("subscription_expired")),
    ).toMatchObject({
      type: "subscription.expired",
      subscriptionId: "1",
    });
  });

  test("ignores subscription_paused (there is no paused status, and it must not be mistaken for a payment failure)", () => {
    expect(
      parseLemonSqueezyEvent(lemonSqueezySample("subscription_paused")),
    ).toBeNull();
  });

  test("subscription_payment_success → subscription.renewed, orderId is the invoice ID", () => {
    expect(
      parseLemonSqueezyEvent(
        lemonSqueezySample("subscription_payment_success"),
      ),
    ).toMatchObject({
      type: "subscription.renewed",
      subscriptionId: "1",
      customerId: "2",
      orderId: "1",
      currentPeriodStart: new Date("2023-01-17T12:43:51.000Z"),
      amount: 1500,
      currency: "USD",
      // Invoice events carry no variant_id and no custom_data: the plan stays empty.
      planId: undefined,
    });
  });

  test("subscription_payment_success: planId can only come from custom_data", () => {
    const sample = withCustomData(
      lemonSqueezySample("subscription_payment_success_renewal"),
      { userId: "user_1", planId: "pro" },
    );
    expect(parseLemonSqueezyEvent(sample)).toMatchObject({
      type: "subscription.renewed",
      orderId: "2",
      userId: "user_1",
      planId: "pro",
    });
  });

  test("subscription_payment_failed → payment.failed", () => {
    expect(
      parseLemonSqueezyEvent(lemonSqueezySample("subscription_payment_failed")),
    ).toMatchObject({
      type: "payment.failed",
      subscriptionId: "1",
      orderId: "2",
      amount: 1500,
      currency: "USD",
    });
  });

  test("ignores subscription_payment_recovered (the same collection also gets a success event)", () => {
    expect(
      parseLemonSqueezyEvent(
        lemonSqueezySample("subscription_payment_recovered"),
      ),
    ).toBeNull();
  });

  test("order_refunded (full) → refund.created", () => {
    expect(
      parseLemonSqueezyEvent(lemonSqueezySample("order_refunded")),
    ).toMatchObject({
      type: "refund.created",
      orderId: "2",
      refundId: "2023-02-01T10:00:00.000Z",
      amount: 1860,
      currency: "EUR",
      customerId: "1",
    });
  });

  test("subscription_payment_refunded (full) → refund.created", () => {
    expect(
      parseLemonSqueezyEvent(
        lemonSqueezySample("subscription_payment_refunded"),
      ),
    ).toMatchObject({
      type: "refund.created",
      orderId: "2",
      refundId: "2023-03-01T10:00:00.000Z",
      amount: 1500,
      currency: "USD",
    });
  });

  // Known gap: refunded_amount is cumulative while the downstream refund is an increment; better
  // to miss one than to double count.
  test.each<LemonSqueezySampleEvent>([
    "order_partially_refunded",
    "subscription_payment_partially_refunded",
  ])("%s (partial refund) is not mapped and returns null", (sample) => {
    expect(parseLemonSqueezyEvent(lemonSqueezySample(sample))).toBeNull();
  });

  test("returns null for ignored events", () => {
    expect(
      parseLemonSqueezyEvent(lemonSqueezySample("license_key_created")),
    ).toBeNull();
  });

  test("returns null for a malformed payload", () => {
    expect(parseLemonSqueezyEvent(null)).toBeNull();
    expect(parseLemonSqueezyEvent({})).toBeNull();
    expect(
      parseLemonSqueezyEvent({ meta: { event_name: "order_created" } }),
    ).toBeNull();
    expect(
      parseLemonSqueezyEvent({
        meta: {},
        data: { id: 1, attributes: {} },
      }),
    ).toBeNull();
    // Without a timestamp, don't guess an event ID (otherwise redeliveries would bypass
    // idempotency).
    expect(
      parseLemonSqueezyEvent({
        meta: { event_name: "order_created" },
        data: { id: 1, attributes: { total: 1 } },
      }),
    ).toBeNull();
  });

  test("a duplicate delivery gets the same eventId, and a new one after the resource updates", () => {
    const first = parseLemonSqueezyEvent(lemonSqueezySample("order_created"));
    const again = parseLemonSqueezyEvent(lemonSqueezySample("order_created"));
    expect(again?.eventId).toBe(first?.eventId);

    const changed = lemonSqueezySample("order_created");
    changed.data.attributes.updated_at = "2023-02-01T10:00:00.000000Z";
    expect(parseLemonSqueezyEvent(changed)?.eventId).not.toBe(first?.eventId);
  });
});

describe("createCheckout", () => {
  test("creates a checkout session: store + variant relationships, redirect URL in product_options", async () => {
    const client = fakeClient();
    client.request.mockResolvedValueOnce({
      data: {
        id: "1",
        attributes: { url: "https://store.lemonsqueezy.com/checkout/1" },
      },
    });
    await expect(
      provider(client).createCheckout({
        userId: "user_1",
        planId: "pro",
        successUrl: "https://example.com/billing/success?checkout=1",
        cancelUrl: "https://example.com/#pricing",
        customerEmail: "a@example.com",
      }),
    ).resolves.toEqual({
      checkoutId: "1",
      url: "https://store.lemonsqueezy.com/checkout/1",
    });
    expect(client.request).toHaveBeenCalledWith("POST", "/v1/checkouts", {
      data: {
        type: "checkouts",
        attributes: {
          product_options: {
            redirect_url: "https://example.com/billing/success?checkout=1",
          },
          checkout_data: {
            email: "a@example.com",
            custom: { userId: "user_1", planId: "pro" },
          },
        },
        relationships: {
          store: { data: { type: "stores", id: STORE_ID } },
          variant: {
            data: { type: "variants", id: providerProductId("pro") },
          },
        },
      },
    });
  });

  test("omits email when there is none", async () => {
    const client = fakeClient();
    client.request.mockResolvedValueOnce({
      data: { id: "1", attributes: { url: "https://x.test/1" } },
    });
    await provider(client).createCheckout({
      userId: "user_1",
      planId: "pro",
      successUrl: "https://x.test/success",
      cancelUrl: "https://x.test/#pricing",
    });
    const body = client.request.mock.calls[0]?.[2] as {
      data: { attributes: { checkout_data: Record<string, unknown> } };
    };
    expect(body.data.attributes.checkout_data).toEqual({
      custom: { userId: "user_1", planId: "pro" },
    });
  });

  test("throws for a free plan with no variant ID", async () => {
    await expect(
      provider().createCheckout({
        userId: "user_1",
        planId: "free",
        successUrl: "https://x.test",
        cancelUrl: "https://x.test",
      }),
    ).rejects.toThrow(/providerProductId/);
  });

  test("throws when the response has no url", async () => {
    const client = fakeClient();
    client.request.mockResolvedValueOnce({ data: { id: "1", attributes: {} } });
    await expect(
      provider(client).createCheckout({
        userId: "user_1",
        planId: "pro",
        successUrl: "https://x.test",
        cancelUrl: "https://x.test",
      }),
    ).rejects.toThrow(/url/);
  });
});

describe("getPortalUrl", () => {
  test("returns the customer portal link (pre-signed)", async () => {
    const client = fakeClient();
    client.request.mockResolvedValueOnce({
      data: {
        id: "2",
        attributes: {
          urls: {
            customer_portal:
              "https://store.lemonsqueezy.com/billing?signature=x",
          },
        },
      },
    });
    await expect(provider(client).getPortalUrl("2")).resolves.toBe(
      "https://store.lemonsqueezy.com/billing?signature=x",
    );
    expect(client.request).toHaveBeenCalledWith("GET", "/v1/customers/2");
  });

  // customer_portal is null when the customer has no subscriptions: that's "the customer record
  // exists but all subscriptions have ended", a different edge case from openPortal returning
  // no_customer (no customer record), so all we can do here is throw a clear error.
  test("throws when customer_portal is null (customer has no subscriptions)", async () => {
    const client = fakeClient();
    client.request.mockResolvedValueOnce({
      data: { id: "2", attributes: { urls: { customer_portal: null } } },
    });
    await expect(provider(client).getPortalUrl("2")).rejects.toThrow(
      /customer_portal/,
    );
  });
});

describe("cancelSubscription", () => {
  test("active subscription: DELETE cancels future charges", async () => {
    const client = fakeClient();
    client.request.mockResolvedValueOnce({
      data: { attributes: { status: "active" } },
    });
    await provider(client).cancelSubscription("1");
    expect(client.request).toHaveBeenNthCalledWith(
      1,
      "GET",
      "/v1/subscriptions/1",
    );
    expect(client.request).toHaveBeenNthCalledWith(
      2,
      "DELETE",
      "/v1/subscriptions/1",
    );
  });

  test.each(["cancelled", "expired"])(
    "already %s: skips canceling and counts as success",
    async (status) => {
      const client = fakeClient();
      client.request.mockResolvedValueOnce({
        data: { attributes: { status } },
      });
      await provider(client).cancelSubscription("1");
      expect(client.request).toHaveBeenCalledTimes(1);
    },
  );

  test("subscription not found (GET 404): counts as success", async () => {
    const client = fakeClient();
    client.request.mockRejectedValueOnce(new LemonSqueezyApiError(404, "{}"));
    await expect(
      provider(client).cancelSubscription("1"),
    ).resolves.toBeUndefined();
  });

  test("404 on DELETE: also counts as success", async () => {
    const client = fakeClient();
    client.request
      .mockResolvedValueOnce({ data: { attributes: { status: "active" } } })
      .mockRejectedValueOnce(new LemonSqueezyApiError(404, "{}"));
    await expect(
      provider(client).cancelSubscription("1"),
    ).resolves.toBeUndefined();
  });

  test("other errors: rethrown", async () => {
    const client = fakeClient();
    client.request.mockRejectedValueOnce(new LemonSqueezyApiError(500, "boom"));
    await expect(provider(client).cancelSubscription("1")).rejects.toThrow(
      /500/,
    );
  });
});

test("provider.id is lemonsqueezy", () => {
  expect(provider().id).toBe("lemonsqueezy");
});

test("parseEvent is parseLemonSqueezyEvent", () => {
  expect(provider().parseEvent(lemonSqueezySample("order_created"))).toEqual(
    parseLemonSqueezyEvent(lemonSqueezySample("order_created")),
  );
});
