import { createHmac, timingSafeEqual } from "node:crypto";

import type { Plan } from "@/core/config/schema";
import { logger } from "@/core/observability/logger";

import type { BillingEvent } from "../events";
import { getPlan } from "../plans";
import type { Checkout, CreateCheckoutInput } from "../provider";
import { FakeProvider } from "../testing/fake-provider";

/**
 * In-app payment provider for e2e (BILLING_PROVIDER=fake, only available locally and in CI; see
 * fakeBillingAllowed).
 * - The checkout URL points at the in-app simulated payment page /api/billing/fake/checkout, where
 *   you can set a webhook delay or skip sending the webhook.
 * - After "paying", it redirects to the success page and, after the delay, POSTs signed events to
 *   /api/webhooks/fake, which go through the same handling pipeline as Creem.
 * The signing secret is a public constant: fake mode is never allowed in any deployed environment
 * anyway.
 */
export const FAKE_PROVIDER_ID = "fake";
const FAKE_SECRET = "fake-billing-secret-for-local-and-ci-only";

export const FAKE_CHECKOUT_PATH = "/api/billing/fake/checkout";
export const FAKE_PORTAL_PATH = "/api/billing/fake/portal";
export const FAKE_WEBHOOK_PATH = "/api/webhooks/fake";

/**
 * Simulated checkout session, encoded in the checkout URL's token so it doesn't rely on process
 * memory.
 */
export type FakeCheckoutSession = {
  checkoutId: string;
  userId: string;
  planId: string;
  successUrl: string;
};

function hmac(value: string) {
  return createHmac("sha256", FAKE_SECRET).update(value).digest("base64url");
}

export function signFakeSession(session: FakeCheckoutSession) {
  const body = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${body}.${hmac(body)}`;
}

/** Verifies the token and extracts the session; returns null on a bad signature or shape. */
export function verifyFakeSession(
  token: string | null,
): FakeCheckoutSession | null {
  const [body, signature] = token?.split(".") ?? [];
  if (!body || !signature) return null;
  const expected = Buffer.from(hmac(body));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null;
  }
  try {
    const session = JSON.parse(Buffer.from(body, "base64url").toString());
    return typeof session?.checkoutId === "string" &&
      typeof session?.userId === "string" &&
      typeof session?.planId === "string" &&
      typeof session?.successUrl === "string"
      ? session
      : null;
  } catch {
    return null;
  }
}

class AppFakeProvider extends FakeProvider {
  constructor() {
    super(FAKE_SECRET, FAKE_PROVIDER_ID);
  }

  // Returns an in-app relative URL: the frontend redirects to it directly, and the customer
  // portal route expands it to an absolute URL.
  override async createCheckout(input: CreateCheckoutInput): Promise<Checkout> {
    const checkoutId = `chk_fake_${crypto.randomUUID()}`;
    const token = signFakeSession({
      checkoutId,
      userId: input.userId,
      planId: input.planId,
      successUrl: input.successUrl,
    });
    return {
      checkoutId,
      url: `${FAKE_CHECKOUT_PATH}?token=${encodeURIComponent(token)}`,
    };
  }

  override async getPortalUrl(customerId: string): Promise<string> {
    return `${FAKE_PORTAL_PATH}?customer=${encodeURIComponent(customerId)}`;
  }
}

export function createFakeBillingProvider() {
  return new AppFakeProvider();
}

function addInterval(start: Date, plan: Plan) {
  const end = new Date(start);
  if (plan.interval === "year") end.setUTCFullYear(end.getUTCFullYear() + 1);
  else end.setUTCMonth(end.getUTCMonth() + 1);
  return end;
}

/**
 * The events and return parameters produced by one simulated payment, in the same order as Creem:
 * a subscription is subscription.active → subscription.renewed (first-period charge, grants
 * credits) → checkout.completed; a one-time purchase is just a checkout.completed with an order.
 * The return parameter names also match Creem.
 */
export function fakePayment(
  provider: FakeProvider,
  session: FakeCheckoutSession,
  now = new Date(),
): { events: BillingEvent[]; returnParams: Record<string, string> } | null {
  const plan = getPlan(session.planId);
  if (!plan || plan.price === 0) return null;

  const suffix = session.checkoutId.replace(/^chk_fake_/, "");
  const customerId = `cust_fake_${session.userId}`;
  const base = { userId: session.userId, customerId, planId: plan.id };
  const money = {
    amount: Math.round(plan.price * 100),
    currency: "USD",
  };

  if (plan.type === "subscription") {
    const subscriptionId = `sub_fake_${suffix}`;
    const period = {
      currentPeriodStart: now,
      currentPeriodEnd: addInterval(now, plan),
    };
    const at = (offset: number) => new Date(now.getTime() + offset);
    return {
      events: [
        provider.event("subscription.active", {
          ...base,
          ...period,
          subscriptionId,
          occurredAt: at(0),
        }),
        provider.event("subscription.renewed", {
          ...base,
          ...period,
          ...money,
          subscriptionId,
          orderId: `tran_fake_${suffix}`,
          occurredAt: at(1),
        }),
        provider.event("checkout.completed", {
          ...base,
          checkoutId: session.checkoutId,
          subscriptionId,
          occurredAt: at(2),
        }),
      ],
      returnParams: {
        checkout_id: session.checkoutId,
        subscription_id: subscriptionId,
        customer_id: customerId,
      },
    };
  }

  const orderId = `ord_fake_${suffix}`;
  return {
    events: [
      provider.event("checkout.completed", {
        ...base,
        ...money,
        checkoutId: session.checkoutId,
        orderId,
        occurredAt: now,
      }),
    ],
    returnParams: {
      checkout_id: session.checkoutId,
      order_id: orderId,
      customer_id: customerId,
    },
  };
}

/** Signs the events and POSTs them, in order, to the in-app webhook. */
export async function deliverFakeWebhooks(
  provider: FakeProvider,
  origin: string,
  events: BillingEvent[],
) {
  for (const event of events) {
    const request = provider.request(event);
    const response = await fetch(new URL(FAKE_WEBHOOK_PATH, origin), {
      method: "POST",
      headers: request.headers,
      body: await request.text(),
    });
    if (!response.ok) {
      logger.error("billing.fake_webhook_failed", {
        eventType: event.type,
        status: response.status,
      });
    }
  }
}
