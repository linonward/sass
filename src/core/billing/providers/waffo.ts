import {
  verifyWebhook,
  WaffoPancake,
  type WebhookEvent,
  type WebhookEventData,
} from "@waffo/pancake-ts";

import siteConfig from "../../../../site.config";
import type { WaffoMode } from "../env";
import type { BillingEvent } from "../events";
import { getPlan } from "../plans";
import {
  WebhookVerificationError,
  type Checkout,
  type CreateCheckoutInput,
  type PaymentProvider,
} from "../provider";

/**
 * Adapter for Waffo Pancake (https://pancake.waffo.ai, a MoR), using the official SDK
 * `@waffo/pancake-ts`.
 *
 * Like Creem and Lemon Squeezy it is a MoR with a product catalog: a plan's `providerProductId` is
 * the Pancake product ID (`PROD_…`, separate for test and prod), and the amount and interval are
 * defined on the product in the Pancake dashboard.
 *
 * - Checkout: `checkout.authenticated.create`. `buyerIdentity` = our user ID (orders are bound to
 *   it, so changing email never mixes up orders), and `metadata` carries userId / planId, which
 *   the webhook's `orderMetadata` echoes back unchanged.
 * - Signature verification: `verifyWebhook` (`X-Waffo-Signature`, RSA-SHA256, timestamped against
 *   replay), **always against the `WAFFO_MODE` environment**, and the event's `mode` is checked
 *   again — otherwise a production site would accept test-environment payments (free test cards)
 *   and grant credits.
 * - The occurrence time comes from the envelope's `timestamp`; see below for the idempotency key.
 * - Cancel: `orders.cancelSubscription` — an active subscription becomes canceling and stays
 *   usable until the end of the current period.
 *
 * Event mapping (Pancake → BillingEvent):
 *
 * | Pancake                                                         | BillingEvent          |
 * | --------------------------------------------------------------- | --------------------- |
 * | order.completed (first payment of a one-time order succeeded)   | checkout.completed    |
 * | subscription.activated / renewed / recovered / uncanceled       | subscription.active   |
 * | subscription.payment_succeeded (every period's charge, incl. first) | subscription.renewed |
 * | subscription.canceling (canceled, usable until period end)      | subscription.canceled |
 * | subscription.canceled (fully terminated)                        | subscription.expired  |
 * | subscription.past_due (renewal charge failed)                   | payment.failed        |
 * | refund.succeeded                                                | refund.created        |
 * | refund.failed, plan_change_*, etc.                              | Ignored               |
 *
 * Order ID convention: one template order = one Pancake payment (`paymentId`, `PAY_…`), the same
 * for one-time orders and for each subscription period. Refund events carry the `paymentId` being
 * refunded, so both partial and full refunds match the exact payment (including a specific
 * subscription period). The subscription ID is the `orderId` (`ORD_…`) of the subscription order.
 *
 * The idempotency key is "event type + eventId": the official docs and the SDK disagree on what
 * the envelope's `id` means (event entity ID vs. delivery record UUID), and the official docs
 * recommend deduplicating by eventType + eventId, which is safe under either reading.
 *
 * The subscription ID doubles as the customer ID (Pancake has no separate customer object). Plan
 * upgrades/downgrades (plan_change) are not handled: the template has no plan-switching flow.
 * Declined one-time payments and abandoned checkouts send no webhook (the order stays pending), so
 * they need no mapping.
 */

export const WAFFO_PROVIDER_ID = "waffo";

/**
 * Pancake's hosted customer portal: magic-link login, shared across merchants. There is no
 * official API yet for a "pre-authenticated" portal link.
 */
export const WAFFO_PORTAL_URL =
  "https://pancake.waffo.ai/consumer/portal/login";

/**
 * Subscription order statuses that will never be charged again: canceling (usable until period
 * end), closed, canceled, expired.
 */
const ENDED_SUBSCRIPTION = new Set([
  "canceling",
  "closed",
  "canceled",
  "expired",
]);

/**
 * The ISO 4217 minor-unit digits of a currency (the template stores all amounts this way, e.g.
 * USD 2, JPY 0, KWD 3).
 * Uses an explicit table rather than `Intl`: for some currencies (e.g. IDR) Node's ICU returns
 * display digits, not the ISO ones.
 */
const ISO_ZERO_DECIMAL = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "ISK",
  "JPY",
  "KMF",
  "KRW",
  "PYG",
  "RWF",
  "UGX",
  "UYI",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);
const ISO_THREE_DECIMAL = new Set([
  "BHD",
  "IQD",
  "JOD",
  "KWD",
  "LYD",
  "OMR",
  "TND",
]);

function isoDigits(currency: string) {
  if (ISO_ZERO_DECIMAL.has(currency)) return 0;
  if (ISO_THREE_DECIMAL.has(currency)) return 3;
  return 2;
}

/**
 * Pancake's display amount (a decimal string, e.g. "29.00") → the template's smallest currency
 * unit.
 */
export function waffoMinorUnits(
  amount: string | undefined,
  currency: string,
): number | undefined {
  if (amount === undefined || amount === "") return undefined;
  const value = Number(amount.replace(/,/g, ""));
  if (!Number.isFinite(value)) return undefined;
  return Math.round(value * 10 ** isoDigits(currency));
}

function asDate(value: string | undefined) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export type WaffoProviderOptions = {
  merchantId: string;
  privateKey: string;
  mode: WaffoMode;
  /** Injected by tests: replaces the SDK's fetch so nothing hits the network. */
  fetch?: typeof fetch;
  /**
   * Injected by tests: the public key for webhook signature verification (production uses the
   * Waffo public key bundled with the SDK).
   */
  webhookPublicKey?: string;
};

type PancakeEvent = WebhookEvent<WebhookEventData>;

export function createWaffoProvider({
  merchantId,
  privateKey,
  mode,
  fetch: fetchImpl,
  webhookPublicKey,
}: WaffoProviderOptions): PaymentProvider {
  const client = new WaffoPancake({
    merchantId,
    privateKey,
    environment: mode,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });

  function mapEvent(event: PancakeEvent): BillingEvent | null {
    const data = event.data;
    const metadata = data.orderMetadata ?? {};
    const currency = data.currency;
    const planId = metadata.planId || undefined;
    const common = {
      provider: WAFFO_PROVIDER_ID,
      eventId: `${event.eventType}:${event.eventId || event.id}`,
      occurredAt: asDate(event.timestamp) ?? new Date(),
      userId:
        metadata.userId || data.merchantProvidedBuyerIdentity || undefined,
      raw: event,
    };
    const subscription = {
      ...common,
      customerId: data.orderId,
      subscriptionId: data.orderId,
    };
    const period = {
      currentPeriodStart: asDate(data.currentPeriodStart),
      currentPeriodEnd: asDate(data.currentPeriodEnd),
    };

    switch (event.eventType) {
      case "order.completed":
        return {
          ...common,
          type: "checkout.completed",
          checkoutId: data.orderId,
          orderId: data.paymentId ?? data.orderId,
          planId,
          amount: waffoMinorUnits(data.chargedAmount ?? data.amount, currency),
          currency,
        };

      case "subscription.activated":
      case "subscription.renewed":
      case "subscription.recovered":
      case "subscription.uncanceled":
        return {
          ...subscription,
          ...period,
          type: "subscription.active",
          planId,
        };

      case "subscription.payment_succeeded":
        if (!data.paymentId) return null;
        return {
          ...subscription,
          type: "subscription.renewed",
          orderId: data.paymentId,
          planId,
          amount: waffoMinorUnits(data.chargedAmount ?? data.amount, currency),
          currency,
        };

      case "subscription.canceling":
        return {
          ...subscription,
          type: "subscription.canceled",
          currentPeriodEnd: period.currentPeriodEnd,
        };

      case "subscription.canceled":
        return { ...subscription, type: "subscription.expired" };

      case "subscription.past_due":
        return {
          ...subscription,
          type: "payment.failed",
          ...(data.paymentId ? { orderId: data.paymentId } : {}),
        };

      case "refund.succeeded": {
        const amount = waffoMinorUnits(
          data.refundedAmount ?? data.amount,
          currency,
        );
        if (!data.paymentId || amount === undefined) return null;
        return {
          ...common,
          type: "refund.created",
          // The refunded payment (a one-time order or one subscription period), using the same
          // order IDs as when the payment was recorded.
          orderId: data.paymentId,
          // eventId is the Pancake refund ID (REF_…).
          refundId: event.eventId || event.id,
          amount,
          currency,
        };
      }

      default:
        return null;
    }
  }

  return {
    id: WAFFO_PROVIDER_ID,

    async createCheckout(input: CreateCheckoutInput): Promise<Checkout> {
      const plan = getPlan(input.planId);
      if (!plan?.providerProductId) {
        throw new Error(`Plan "${input.planId}" has no providerProductId`);
      }
      const result = await client.checkout.authenticated.create({
        productId: plan.providerProductId,
        currency: siteConfig.billing.currency,
        buyerIdentity: input.userId,
        ...(input.customerEmail ? { buyerEmail: input.customerEmail } : {}),
        successUrl: input.successUrl,
        metadata: { userId: input.userId, planId: plan.id },
        orderMerchantExternalId: `${input.userId}:${plan.id}`.slice(0, 128),
      });
      return { checkoutId: result.sessionId, url: result.checkoutUrl };
    },

    /**
     * Pancake's hosted customer portal uses magic-link login (the buyer enters an email and gets a
     * link), and there is no official API yet for a "pre-authenticated" link, so this returns the
     * portal login page: after logging in with the email used at payment, the buyer can view
     * orders, download invoices, and cancel or resume subscriptions.
     */
    async getPortalUrl(): Promise<string> {
      return WAFFO_PORTAL_URL;
    },

    /**
     * Called on account deletion: an active subscription becomes canceling (no more renewals,
     * usable until the end of the current period).
     * The template's contract is "an already canceled or missing subscription counts as success"
     * (the account-deletion hook must be safe to retry): when the API errors, look up the
     * subscription order once; if it will never be charged again (or can't be found), treat it as
     * success, otherwise rethrow the original error.
     */
    async cancelSubscription(subscriptionId: string): Promise<void> {
      try {
        await client.orders.cancelSubscription({ orderId: subscriptionId });
        return;
      } catch (error) {
        const result = await client.graphql.query<{
          subscriptionOrder: { status: string } | null;
        }>({
          query: "query ($id: ID!) { subscriptionOrder(id: $id) { status } }",
          variables: { id: subscriptionId },
        });
        const status = result.data?.subscriptionOrder?.status;
        if (!status || ENDED_SUBSCRIPTION.has(status)) return;
        throw error;
      }
    },

    async verifyWebhook(request: Request): Promise<unknown> {
      const body = await request.text();
      const signature = request.headers.get("x-waffo-signature");
      if (!signature) throw new WebhookVerificationError();
      let event: PancakeEvent;
      try {
        event = verifyWebhook<WebhookEventData>(body, signature, {
          environment: mode,
          ...(webhookPublicKey ? { publicKey: webhookPublicKey } : {}),
        });
      } catch {
        throw new WebhookVerificationError();
      }
      // Valid signature, but from the other environment (e.g. a production site receiving a
      // test-mode payment): treat it as invalid and don't process it.
      if (event.mode && event.mode !== mode) {
        throw new WebhookVerificationError(
          `Waffo webhook from ${event.mode} rejected in ${mode} mode`,
        );
      }
      return event;
    },

    parseEvent(payload: unknown): BillingEvent | null {
      const event = payload as PancakeEvent | null;
      if (
        !event ||
        typeof event !== "object" ||
        typeof event.id !== "string" ||
        typeof event.eventType !== "string" ||
        !event.data ||
        typeof event.data.orderId !== "string" ||
        typeof event.data.currency !== "string"
      ) {
        return null;
      }
      return mapEvent(event);
    },
  };
}
