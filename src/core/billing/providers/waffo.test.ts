import { createSign, generateKeyPairSync } from "node:crypto";

import { beforeEach, describe, expect, test, vi } from "vitest";

import { WebhookVerificationError } from "../provider";
import { processWebhook } from "../webhook";
import {
  createWaffoProvider,
  WAFFO_PORTAL_URL,
  waffoMinorUnits,
} from "./waffo";

// The real official SDK (@waffo/pancake-ts) plus an injected fake fetch: the SDK really signs the
// requests, without touching the network.
// Webhooks are signed with a locally generated RSA key in Pancake's format
// (X-Waffo-Signature: t=<milliseconds>,v1=<base64>, signing input `${t}.${body}`), and the public
// key is injected for signature verification via `webhookPublicKey` — production uses the public
// key bundled with the SDK.
// Event shapes come from the docs/webhook-guide.md shipped with the SDK
// (WebhookEvent / WebhookEventData).

// Plan product IDs must match Pancake's format (PROD_ + 22 characters).
vi.mock("../plans", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../plans")>();
  const products: Record<string, string> = {
    pro: "PROD_000000000000000000pro1",
    lifetime: "PROD_00000000000000000life1",
  };
  return {
    ...actual,
    getPlan: (id: string) => {
      const plan = actual.getPlan(id);
      return plan && products[id]
        ? { ...plan, providerProductId: products[id] }
        : plan;
    },
  };
});

const MERCHANT_ID = "MER_0000000000000000000abc";
const merchant = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const waffo = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

type Call = { path: string; body: Record<string, unknown>; headers: Headers };

function fakeFetch() {
  const calls: Call[] = [];
  const replies = new Map<string, unknown[]>();
  const fetchImpl = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push({
        path: url.pathname,
        body: JSON.parse(String(init?.body ?? "{}")),
        headers: new Headers(init?.headers),
      });
      const reply = replies.get(url.pathname)?.shift() ?? { data: {} };
      return new Response(JSON.stringify(reply), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  );
  return {
    fetch: fetchImpl as unknown as typeof fetch,
    calls,
    reply(path: string, body: unknown) {
      replies.set(path, [...(replies.get(path) ?? []), body]);
    },
  };
}

function setup(mode: "test" | "prod" = "test") {
  const http = fakeFetch();
  const provider = createWaffoProvider({
    merchantId: MERCHANT_ID,
    privateKey: merchant.privateKey,
    mode,
    fetch: http.fetch,
    webhookPublicKey: waffo.publicKey,
  });
  return { provider, http };
}

function signed(body: string, key = waffo.privateKey, t = Date.now()) {
  const signer = createSign("RSA-SHA256");
  signer.update(`${t}.${body}`);
  return `t=${t},v1=${signer.sign(key, "base64")}`;
}

function webhookRequest(event: unknown, signature?: string | null) {
  const body = JSON.stringify(event);
  return new Request("https://acme.test/api/webhooks/waffo", {
    method: "POST",
    headers:
      signature === null
        ? {}
        : { "x-waffo-signature": signature ?? signed(body) },
    body,
  });
}

const ORDER = "ORD_0000000000000000000001";
const SUB = "ORD_0000000000000000000sub";

function event(
  eventType: string,
  data: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
) {
  return {
    id: `dlv-${eventType}`,
    timestamp: "2026-09-29T08:01:00.000Z",
    eventType,
    eventId: `evt-${eventType}`,
    storeId: "STO_0000000000000000000001",
    storeName: "OnwardKit",
    mode: "test",
    data: {
      orderId: ORDER,
      buyerEmail: "ada@example.com",
      merchantProvidedBuyerIdentity: "user_1",
      orderMetadata: { userId: "user_1", planId: "lifetime" },
      currency: "USD",
      amount: "199.00",
      taxAmount: "0.00",
      productName: "Lifetime",
      ...data,
    },
    ...extra,
  };
}

const subscriptionData = {
  orderId: SUB,
  orderMetadata: { userId: "user_1", planId: "pro" },
  amount: "19.00",
  currentPeriodStart: "2026-09-29T08:00:00.000Z",
  currentPeriodEnd: "2026-10-29T08:00:00.000Z",
};

describe("Waffo Pancake adapter", () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
  });

  test("amounts: display format → ISO minor units", () => {
    expect(waffoMinorUnits("29.00", "USD")).toBe(2900);
    expect(waffoMinorUnits("1,299.50", "USD")).toBe(129950);
    expect(waffoMinorUnits("1000", "JPY")).toBe(1000);
    expect(waffoMinorUnits("150000", "IDR")).toBe(15000000);
    expect(waffoMinorUnits("1.234", "KWD")).toBe(1234);
    expect(waffoMinorUnits(undefined, "USD")).toBeUndefined();
    expect(waffoMinorUnits("n/a", "USD")).toBeUndefined();
  });

  test("checkout: authenticated checkout, product ID from the plan config, buyerIdentity is the user ID, metadata carries user and plan back", async () => {
    s.http.reply("/v1/actions/auth/issue-session-token", {
      data: { token: "jwt-token", expiresAt: "2026-09-29T09:00:00Z" },
    });
    s.http.reply("/v1/actions/checkout/create-session", {
      data: {
        sessionId: "CKS_0000000000000000000001",
        checkoutUrl: "https://pancake.waffo.ai/store/onwardkit/checkout/CKS_1",
        expiresAt: "2026-09-29T08:45:00Z",
      },
    });
    const result = await s.provider.createCheckout({
      userId: "user_1",
      planId: "pro",
      customerEmail: "ada@example.com",
      successUrl: "https://acme.test/en/billing/success",
      cancelUrl: "https://acme.test/en#pricing",
    });

    expect(result).toEqual({
      checkoutId: "CKS_0000000000000000000001",
      url: "https://pancake.waffo.ai/store/onwardkit/checkout/CKS_1#token=jwt-token",
    });
    const token = s.http.calls.find((c) =>
      c.path.endsWith("issue-session-token"),
    )!;
    expect(token.body).toEqual({
      productId: "PROD_000000000000000000pro1",
      buyerIdentity: "user_1",
    });
    const session = s.http.calls.find((c) =>
      c.path.endsWith("create-session"),
    )!;
    expect(session.body).toMatchObject({
      productId: "PROD_000000000000000000pro1",
      currency: "USD",
      buyerEmail: "ada@example.com",
      successUrl: "https://acme.test/en/billing/success",
      metadata: { userId: "user_1", planId: "pro" },
      orderMerchantExternalId: "user_1:pro",
    });
    // The SDK signs the request with the merchant private key and includes the merchant ID and
    // environment.
    expect(session.headers.get("x-merchant-id")).toBe(MERCHANT_ID);
    expect(session.headers.get("x-signature")).toBeTruthy();
  });

  test("checkout: throws when the plan has no product ID (never calls the provider with an empty ID)", async () => {
    await expect(
      s.provider.createCheckout({
        userId: "user_1",
        planId: "free",
        successUrl: "https://acme.test/s",
        cancelUrl: "https://acme.test/c",
      }),
    ).rejects.toThrow(/providerProductId/);
    expect(s.http.calls).toHaveLength(0);
  });

  describe("webhook signature verification", () => {
    test("accepts events signed with the Waffo private key", async () => {
      const payload = event("order.completed");
      await expect(
        s.provider.verifyWebhook(webhookRequest(payload)),
      ).resolves.toEqual(payload);
    });

    test("missing signature, wrong signature, signed over different content, and expired timestamp all throw WebhookVerificationError", async () => {
      const payload = event("order.completed");
      const body = JSON.stringify(payload);
      for (const request of [
        webhookRequest(payload, null),
        webhookRequest(payload, signed(body, merchant.privateKey)),
        webhookRequest(payload, signed(`${body} `)),
        webhookRequest(
          payload,
          signed(body, waffo.privateKey, Date.now() - 60 * 60 * 1000),
        ),
        webhookRequest(payload, "garbage"),
      ]) {
        await expect(s.provider.verifyWebhook(request)).rejects.toBeInstanceOf(
          WebhookVerificationError,
        );
      }
    });

    test("environment mismatch: a production site rejects test-environment events (free test cards must not grant credits in production)", async () => {
      const prod = setup("prod");
      await expect(
        prod.provider.verifyWebhook(webhookRequest(event("order.completed"))),
      ).rejects.toBeInstanceOf(WebhookVerificationError);
      await expect(
        prod.provider.verifyWebhook(
          webhookRequest(event("order.completed", {}, { mode: "prod" })),
        ),
      ).resolves.toMatchObject({ mode: "prod" });
    });

    test("processWebhook: unsigned is 401; ignored events are 200 ignored", async () => {
      const unsigned = await processWebhook(
        s.provider,
        webhookRequest(event("order.completed"), null),
      );
      expect(unsigned.status).toBe(401);
      const ignored = await processWebhook(
        s.provider,
        webhookRequest(
          event("subscription.plan_change_scheduled", subscriptionData),
        ),
      );
      expect(ignored.status).toBe(200);
      expect(await ignored.json()).toEqual({ status: "ignored" });
    });
  });

  describe("parseEvent", () => {
    test("order.completed → checkout.completed: the order is this payment (paymentId), the amount is what was actually paid, and the idempotency key is event type + eventId", () => {
      expect(
        s.provider.parseEvent(
          event("order.completed", {
            chargedAmount: "199.00",
            paymentId: "PAY_0000000000000000000one",
          }),
        ),
      ).toEqual({
        provider: "waffo",
        type: "checkout.completed",
        eventId: "order.completed:evt-order.completed",
        occurredAt: new Date("2026-09-29T08:01:00.000Z"),
        userId: "user_1",
        checkoutId: ORDER,
        orderId: "PAY_0000000000000000000one",
        planId: "lifetime",
        amount: 19900,
        currency: "USD",
        raw: expect.anything(),
      });
      // If paymentId is missing, fall back to the order ID (the payment is still recorded, but
      // refunds won't match).
      expect(s.provider.parseEvent(event("order.completed"))).toMatchObject({
        orderId: ORDER,
      });
    });

    test("user ID: metadata first, then buyerIdentity", () => {
      const fromIdentity = s.provider.parseEvent(
        event("order.completed", { orderMetadata: undefined }),
      );
      expect(fromIdentity).toMatchObject({
        userId: "user_1",
        planId: undefined,
      });
    });

    test("subscription: activated / renewal / recovered / uncanceled → active (with current period start and end), subscription ID doubles as customer ID", () => {
      for (const type of [
        "subscription.activated",
        "subscription.renewed",
        "subscription.recovered",
        "subscription.uncanceled",
      ]) {
        expect(
          s.provider.parseEvent(event(type, subscriptionData)),
        ).toMatchObject({
          type: "subscription.active",
          subscriptionId: SUB,
          customerId: SUB,
          planId: "pro",
          currentPeriodStart: new Date("2026-09-29T08:00:00.000Z"),
          currentPeriodEnd: new Date("2026-10-29T08:00:00.000Z"),
        });
      }
    });

    test("each period's charge → subscription.renewed, the order is that period's paymentId; ignored without paymentId", () => {
      expect(
        s.provider.parseEvent(
          event("subscription.payment_succeeded", {
            ...subscriptionData,
            paymentId: "PAY_0000000000000000000001",
            chargedAmount: "19.00",
          }),
        ),
      ).toMatchObject({
        type: "subscription.renewed",
        subscriptionId: SUB,
        orderId: "PAY_0000000000000000000001",
        planId: "pro",
        amount: 1900,
        currency: "USD",
      });
      expect(
        s.provider.parseEvent(
          event("subscription.payment_succeeded", subscriptionData),
        ),
      ).toBeNull();
    });

    test("canceling → canceled (usable until period end); fully terminated → expired; renewal failure → payment.failed", () => {
      expect(
        s.provider.parseEvent(
          event("subscription.canceling", subscriptionData),
        ),
      ).toMatchObject({
        type: "subscription.canceled",
        subscriptionId: SUB,
        currentPeriodEnd: new Date("2026-10-29T08:00:00.000Z"),
      });
      expect(
        s.provider.parseEvent(event("subscription.canceled", subscriptionData)),
      ).toMatchObject({ type: "subscription.expired", subscriptionId: SUB });
      expect(
        s.provider.parseEvent(event("subscription.past_due", subscriptionData)),
      ).toMatchObject({ type: "payment.failed", subscriptionId: SUB });
    });

    test("refund: matched by the refunded payment (paymentId) — same scheme for one-time orders and a subscription period; not mapped without paymentId", () => {
      expect(
        s.provider.parseEvent(
          event(
            "refund.succeeded",
            {
              refundedAmount: "49.75",
              paymentId: "PAY_0000000000000000000one",
            },
            { eventId: "REF_0000000000000000000001" },
          ),
        ),
      ).toMatchObject({
        type: "refund.created",
        eventId: "refund.succeeded:REF_0000000000000000000001",
        orderId: "PAY_0000000000000000000one",
        refundId: "REF_0000000000000000000001",
        amount: 4975,
        currency: "USD",
      });
      expect(
        s.provider.parseEvent(
          event("refund.succeeded", {
            ...subscriptionData,
            paymentId: "PAY_0000000000000000000002",
            refundedAmount: "19.00",
          }),
        ),
      ).toMatchObject({
        type: "refund.created",
        orderId: "PAY_0000000000000000000002",
        amount: 1900,
      });
      expect(
        s.provider.parseEvent(
          event("refund.succeeded", { refundedAmount: "1.00" }),
        ),
      ).toBeNull();
      expect(s.provider.parseEvent(event("refund.failed"))).toBeNull();
    });

    test("returns null for ignored or malformed payloads", () => {
      for (const payload of [
        null,
        "x",
        {},
        { id: "x", eventType: "order.completed" },
        { id: "x", eventType: "order.completed", data: { currency: "USD" } },
        event("subscription.plan_changed", subscriptionData),
        event("something.new"),
      ]) {
        expect(s.provider.parseEvent(payload)).toBeNull();
      }
    });
  });

  describe("portal and cancellation", () => {
    test("portal: returns the Pancake hosted portal login page (magic-link login; no official pre-authenticated link yet)", async () => {
      await expect(s.provider.getPortalUrl(SUB)).resolves.toBe(
        WAFFO_PORTAL_URL,
      );
      expect(s.http.calls).toHaveLength(0);
    });

    test("cancel: calls cancel-order; an error counts as success if the subscription will no longer be charged (or can't be found); throws if it is still being charged", async () => {
      s.http.reply("/v1/actions/subscription-order/cancel-order", {
        data: { orderId: SUB, status: "canceling" },
      });
      await expect(s.provider.cancelSubscription(SUB)).resolves.toBeUndefined();
      expect(s.http.calls[0]).toMatchObject({
        path: "/v1/actions/subscription-order/cancel-order",
        body: { orderId: SUB },
      });

      for (const status of ["canceling", "canceled", "expired", "closed"]) {
        s.http.reply("/v1/actions/subscription-order/cancel-order", {
          data: null,
          errors: [{ message: "invalid state", layer: "order" }],
        });
        s.http.reply("/v1/graphql", {
          data: { subscriptionOrder: { status } },
        });
        await expect(
          s.provider.cancelSubscription(SUB),
        ).resolves.toBeUndefined();
      }

      s.http.reply("/v1/actions/subscription-order/cancel-order", {
        data: null,
        errors: [{ message: "not found", layer: "order" }],
      });
      s.http.reply("/v1/graphql", { data: { subscriptionOrder: null } });
      await expect(s.provider.cancelSubscription(SUB)).resolves.toBeUndefined();

      s.http.reply("/v1/actions/subscription-order/cancel-order", {
        data: null,
        errors: [{ message: "psp unavailable", layer: "psp" }],
      });
      s.http.reply("/v1/graphql", {
        data: { subscriptionOrder: { status: "active" } },
      });
      await expect(s.provider.cancelSubscription(SUB)).rejects.toThrow();
    });
  });
});
