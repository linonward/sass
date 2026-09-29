import { createHmac, timingSafeEqual } from "node:crypto";

import type { BillingEvent } from "../events";
import { getPlan, planByProductId } from "../plans";
import {
  WebhookVerificationError,
  type Checkout,
  type CreateCheckoutInput,
  type PaymentProvider,
} from "../provider";
import {
  createLemonSqueezyClient,
  LemonSqueezyApiError,
  LEMONSQUEEZY_PROVIDER_ID,
  type LemonSqueezyClient,
  type LemonSqueezyFetch,
} from "./lemonsqueezy/client";

export { LEMONSQUEEZY_PROVIDER_ID };

/*
 * Lemon Squeezy webhook → BillingEvent mapping (events and fields: see
 * https://docs.lemonsqueezy.com/help/webhooks/event-types and the per-resource object pages):
 *
 * | Lemon Squeezy event                         | BillingEvent              | Notes                                                  |
 * | ------------------------------------------- | ------------------------- | ------------------------------------------------------ |
 * | order_created (variant maps to one-time)    | checkout.completed        | orderId = order ID, amount from total                  |
 * | order_created (subscription plan / unmapped) | checkout.completed       | No orderId: the first subscription period is recorded by the invoice event; unmapped is recorded as one-time |
 * | subscription_created/updated/resumed        | subscription.active       | Dispatched by attributes.status (see below); renews_at → period end |
 * | subscription_cancelled                      | subscription.canceled     | ends_at → period end                                   |
 * | subscription_expired                        | subscription.expired      |                                                        |
 * | subscription_paused / unpaused              | Ignored / subscription.active | See the comment on parseSubscriptionEvent          |
 * | subscription_payment_success                | subscription.renewed      | orderId = invoice ID, amount from total                |
 * | subscription_payment_failed                 | payment.failed            | Carries subscriptionId and the invoice ID              |
 * | subscription_payment_recovered              | Ignored                   | Per the docs it always comes with a subscription_payment_success; recording both would double count |
 * | order_refunded / _payment_refunded          | refund.created            | Mapped only when provably a full refund; see the comment on parseRefundEvent |
 * | Others (license keys, etc.)                 | Ignored                   |                                                        |
 *
 * Order ID convention: one-time purchases and every subscription payment use "the ID of the
 * resource that produced the money" (order ID / invoice ID).
 * Amounts are in the smallest currency unit (cents), consistent with events.ts.
 */

type Loose = Record<string, unknown>;

/**
 * Top level of a Lemon Squeezy webhook: meta describes the event, data is a snapshot of the
 * resource when the event happened.
 */
type LemonSqueezyWebhook = {
  meta: Loose;
  data: Loose;
};

const asObject = (value: unknown): Loose | undefined =>
  value && typeof value === "object" ? (value as Loose) : undefined;
const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;
const asDate = (value: unknown): Date | undefined => {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

/**
 * IDs: JSON:API's data.id is a string, while customer_id / variant_id in attributes are numbers.
 */
const asId = (value: unknown): string | undefined =>
  (typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : undefined) ?? asString(value);

/**
 * Converts an amount to cents.
 *
 * The docs say these fields are "integer cents", but the official examples include decimals
 * (`order_created` gives total as 1859.76, while total_formatted in the same example says
 * $18.59 — the two don't match; see the `$comment` in `__fixtures__/lemonsqueezy-webhooks.json`).
 * Decimals are rounded as a fallback and integers are returned as is, so neither shape gets the
 * amount's order of magnitude wrong.
 */
function toMinorUnits(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.round(parsed);
  }
  return undefined;
}

/**
 * The { userId, planId } passed via `checkout_data.custom` at checkout, echoed back unchanged in
 * the event's meta.custom_data.
 */
function customDataOf(meta: Loose) {
  const custom = asObject(meta.custom_data);
  return {
    userId: asString(custom?.userId),
    planId: asString(custom?.planId),
  };
}

/**
 * The planId in metadata wins; otherwise look it up by the provider-side product ID (variant
 * first, product as a fallback).
 */
function planIdOf(metaPlanId: string | undefined, ...productIds: unknown[]) {
  if (metaPlanId) return metaPlanId;
  for (const productId of productIds) {
    const id = asId(productId);
    const plan = id ? planByProductId(id) : undefined;
    if (plan) return plan.id;
  }
  return undefined;
}

/**
 * Converts a verified Lemon Squeezy webhook body into a BillingEvent; returns null for events we
 * don't care about.
 *
 * Two places where this doesn't fully match what the official docs suggest:
 * 1. **There is no event ID.** meta only has event_name / webhook_id (that's the webhook endpoint
 *    ID, not the ID of this delivery) / custom_data. So we synthesize one from "event name +
 *    resource ID + updated_at": duplicate deliveries (Lemon Squeezy retries, manual resends from
 *    the dashboard) produce the same value and are blocked by (provider, event_id) in
 *    webhook_events; when the resource state really changes, updated_at changes too, so nothing
 *    is blocked by mistake.
 * 2. **Invoice events aren't guaranteed to carry custom_data.** The docs only say it works for
 *    Order / Subscription / license key events, so planId on subscription_payment_* is often
 *    undefined — applySubscription in handle-event only uses planId when the subscription row has
 *    no plan yet, so a missing one doesn't affect renewals.
 */
export function parseLemonSqueezyEvent(payload: unknown): BillingEvent | null {
  const root = asObject(payload) as LemonSqueezyWebhook | undefined;
  const meta = asObject(root?.meta);
  const data = asObject(root?.data);
  const attributes = asObject(data?.attributes);
  const eventName = asString(meta?.event_name);
  const resourceId = asId(data?.id);
  const occurredAt =
    asDate(attributes?.updated_at) ?? asDate(attributes?.created_at);
  // A missing timestamp means this isn't a payload shape we recognize: better to drop it than to
  // make up a random event ID for it (which would let redeliveries bypass the idempotency check).
  if (
    !meta ||
    !data ||
    !attributes ||
    !eventName ||
    !resourceId ||
    !occurredAt
  ) {
    return null;
  }

  const base = {
    provider: LEMONSQUEEZY_PROVIDER_ID,
    eventId: `${eventName}:${resourceId}:${occurredAt.toISOString()}`,
    occurredAt,
    raw: payload,
  };
  const { userId, planId: metaPlanId } = customDataOf(meta);
  const customerId = asId(attributes.customer_id);

  switch (eventName) {
    case "order_created":
      return parseOrderCreated({
        base,
        attributes,
        userId,
        metaPlanId,
        resourceId,
      });

    case "subscription_created":
    case "subscription_updated":
    case "subscription_resumed":
    case "subscription_cancelled":
    case "subscription_expired":
    case "subscription_paused":
    case "subscription_unpaused":
      return parseSubscriptionEvent({
        base,
        attributes,
        userId,
        metaPlanId,
        resourceId,
        customerId,
      });

    case "subscription_payment_success":
    case "subscription_payment_failed":
      return parseInvoiceEvent({
        base,
        eventName,
        attributes,
        userId,
        metaPlanId,
        resourceId,
        customerId,
      });

    case "order_refunded":
    case "subscription_payment_refunded":
      return parseRefundEvent({
        base,
        attributes,
        userId,
        resourceId,
        customerId,
      });

    default:
      // subscription_payment_recovered: per the docs it always comes with a
      // subscription_payment_success, and recording both would double count revenue, so only the
      // latter counts.
      return null;
  }
}

function parseOrderCreated({
  base,
  attributes,
  userId,
  metaPlanId,
  resourceId,
}: {
  base: EventBase;
  attributes: Loose;
  userId: string | undefined;
  metaPlanId: string | undefined;
  resourceId: string;
}): BillingEvent {
  const item = asObject(attributes.first_order_item);
  const planId = planIdOf(metaPlanId, item?.variant_id, item?.product_id);
  const plan = planId ? getPlan(planId) : undefined;
  // Lemon Squeezy also sends order_created for subscriptions (per the docs, subscription_created
  // always comes with an order_created), and the first period's money is recorded by
  // subscription_payment_success — recording both would count the same money twice in revenue
  // (see src/core/admin/metrics.ts), so subscription plans record no order.
  // When no plan can be found, record it as one-time: better to over-record revenue once than to
  // miss a payment.
  const oneTime = plan?.type === "one_time" || !plan;
  return {
    ...base,
    type: "checkout.completed",
    userId,
    customerId: asId(attributes.customer_id),
    // Order events carry no checkout session ID, so use the order ID as a placeholder (downstream
    // only needs orderId).
    checkoutId: resourceId,
    planId,
    orderId: oneTime ? resourceId : undefined,
    amount: toMinorUnits(attributes.total),
    currency: asString(attributes.currency),
  };
}

/**
 * Subscription events are dispatched by `attributes.status`, not by event name — the two can
 * disagree (subscription_updated is the official catch-all, and after a cancellation it may still
 * push an update saying the subscription is cancelled). Mapping by event name to active across the
 * board would "revive" canceled subscriptions.
 *
 * - active / on_trial → subscription.active (renews_at as the period end)
 * - past_due / unpaid → payment.failed
 * - cancelled → subscription.canceled (ends_at as the time access lasts until: there is a grace
 *   period after canceling)
 * - expired → subscription.expired
 * - **paused / pause → ignored.** The subscription status table has no paused (only active /
 *   past_due / canceled / expired). Mapping it to past_due would trigger a "payment failed" email
 *   (the payment.failed branch in emails.ts) even though no payment failed during the pause;
 *   mapping it to canceled would wrongly revoke access. So keep the subscription row's previous
 *   status and wait for subscription_unpaused (status back to active) or subscription_expired to
 *   correct it.
 * - Any other unknown status → null (no guessing)
 */
function parseSubscriptionEvent({
  base,
  attributes,
  userId,
  metaPlanId,
  resourceId,
  customerId,
}: {
  base: EventBase;
  attributes: Loose;
  userId: string | undefined;
  metaPlanId: string | undefined;
  resourceId: string;
  customerId: string | undefined;
}): BillingEvent | null {
  const common = {
    ...base,
    userId,
    customerId,
    subscriptionId: resourceId,
  };
  const period = {
    currentPeriodStart: asDate(attributes.created_at),
    currentPeriodEnd: asDate(attributes.renews_at),
  };
  const planId = planIdOf(
    metaPlanId,
    attributes.variant_id,
    attributes.product_id,
  );

  switch (asString(attributes.status)) {
    case "active":
    case "on_trial":
      return { ...common, ...period, type: "subscription.active", planId };
    case "past_due":
    case "unpaid":
      return { ...common, type: "payment.failed" };
    case "cancelled":
      return {
        ...common,
        type: "subscription.canceled",
        // After canceling it stays usable until ends_at (grace period); renews_at is usually null
        // at this point.
        currentPeriodEnd: asDate(attributes.ends_at) ?? period.currentPeriodEnd,
      };
    case "expired":
      return { ...common, type: "subscription.expired" };
    default:
      return null;
  }
}

/**
 * subscription_payment_success / _failed: data is an invoice object (type
 * `subscription-invoices`). Invoices have no product_id / variant_id, so planId can only come from
 * meta.custom_data (which the docs don't promise on invoice events) — if it's missing, leave it
 * undefined so applySubscription keeps the plan already on the subscription row.
 */
function parseInvoiceEvent({
  base,
  eventName,
  attributes,
  userId,
  metaPlanId,
  resourceId,
  customerId,
}: {
  base: EventBase;
  eventName: string;
  attributes: Loose;
  userId: string | undefined;
  metaPlanId: string | undefined;
  resourceId: string;
  customerId: string | undefined;
}): BillingEvent | null {
  const subscriptionId = asId(attributes.subscription_id);
  if (!subscriptionId) return null;
  const common = {
    ...base,
    userId,
    customerId,
    // orderId is the invoice ID: each subscription payment (including the first) gets one row in
    // orders.
    orderId: resourceId,
    subscriptionId,
    planId: metaPlanId,
    amount: toMinorUnits(attributes.total),
    currency: asString(attributes.currency),
  };
  if (eventName === "subscription_payment_success") {
    return {
      ...common,
      type: "subscription.renewed",
      // The invoice's created_at is the start of this billing period: credits are granted per
      // "subscription + period", so the key must be stable (see billingGrantSourceId in
      // grant-credits.ts).
      currentPeriodStart: asDate(attributes.created_at),
    };
  }
  // A failed invoice also records an order row (status = failed): revenue only counts the paid /
  // refunded statuses (see collectedStatuses in metrics.ts), so revenue stats are unaffected; when
  // the money is collected later, subscription_payment_success turns the same row into paid
  // (a successful payment wins in mergeOrder).
  return { ...common, type: "payment.failed" };
}

/**
 * Refunds. **Mapped only when it can be proven to be a full refund**:
 *
 * - `refunded_amount` is the **cumulative** refunded amount on the order/invoice, while the
 *   downstream `refund.created` contract is **the amount added by this refund** (mergeOrder in
 *   handle-event accumulates refunds). Emitting the cumulative value as the increment would double
 *   count the second partial refund on the same order and reclaim too many credits.
 * - Both objects have a `refunded` value for `status`; the docs describe it as "paid but
 *   **subsequently fully refunded**" (invoice) / refunded in the order status table. It is the
 *   only field that distinguishes full from partial refunds, so it is required, with
 *   `refunded_amount >= total` as a backstop — a full refund happens only once, so the emitted
 *   `amount` is neither duplicated nor miscalculated.
 * - **Known gap: partial refunds are not mapped** (status is still paid / the cumulative amount
 *   hasn't reached the total). Credits for such orders are not reclaimed automatically and need
 *   manual handling. Better not to reclaim than to get the money wrong — no guessing amounts, no
 *   emitting half a refund.
 */
function parseRefundEvent({
  base,
  attributes,
  userId,
  resourceId,
  customerId,
}: {
  base: EventBase;
  attributes: Loose;
  userId: string | undefined;
  resourceId: string;
  customerId: string | undefined;
}): BillingEvent | null {
  const amount = toMinorUnits(attributes.refunded_amount);
  const total = toMinorUnits(attributes.total);
  const currency = asString(attributes.currency);
  if (
    attributes.refunded !== true ||
    asString(attributes.status) !== "refunded" ||
    amount === undefined ||
    amount <= 0 ||
    total === undefined ||
    amount < total ||
    !currency
  ) {
    return null;
  }
  const refundedAt = asDate(attributes.refunded_at);
  return {
    ...base,
    type: "refund.created",
    userId,
    customerId,
    orderId: resourceId,
    // A full refund happens only once per order; refunded_at is stable, so on redelivery the
    // reclaim ledger entry's (source, sourceId) also recognizes it as the same refund (see
    // reclaim-credits.ts).
    refundId: (refundedAt ?? base.occurredAt).toISOString(),
    amount,
    currency,
  };
}

type EventBase = Pick<
  BillingEvent,
  "provider" | "eventId" | "occurredAt" | "raw"
>;

export type LemonSqueezyProviderOptions = {
  apiKey: string;
  webhookSecret: string;
  /** Store ID (`LEMONSQUEEZY_STORE_ID`): required to create checkout sessions. */
  storeId: string;
  /** Injected by tests; defaults to the hand-written HTTP client built from apiKey. */
  client?: LemonSqueezyClient;
  /** Fake fetch injected by tests (only used when no client is passed). */
  fetch?: LemonSqueezyFetch;
};

export function createLemonSqueezyProvider({
  apiKey,
  webhookSecret,
  storeId,
  client,
  fetch,
}: LemonSqueezyProviderOptions): PaymentProvider {
  const lemonSqueezy =
    client ?? createLemonSqueezyClient({ apiKey, ...(fetch && { fetch }) });

  return {
    id: LEMONSQUEEZY_PROVIDER_ID,

    async createCheckout(input: CreateCheckoutInput): Promise<Checkout> {
      const variantId = planVariantId(input.planId);
      const document = await lemonSqueezy.request("POST", "/v1/checkouts", {
        data: {
          type: "checkouts",
          attributes: {
            // The redirect URL goes in product_options, **not** in checkout_data (a common
            // mistake).
            product_options: { redirect_url: input.successUrl },
            checkout_data: {
              ...(input.customerEmail && { email: input.customerEmail }),
              // Echoed back unchanged in the webhook's meta.custom_data, except on invoice events
              // (see the comment above).
              custom: { userId: input.userId, planId: input.planId },
            },
          },
          relationships: {
            store: { data: { type: "stores", id: storeId } },
            variant: { data: { type: "variants", id: variantId } },
          },
        },
      });
      const data = asObject(asObject(document)?.data);
      const url = asString(asObject(data?.attributes)?.url);
      const checkoutId = asId(data?.id);
      if (!url || !checkoutId) {
        throw new Error("Lemon Squeezy checkout has no url");
      }
      // Lemon Squeezy checkout has no cancel URL parameter; the user just closes the page
      // (input.cancelUrl is unused).
      return { checkoutId, url };
    },

    /**
     * Customer portal URL: `GET /v1/customers/:id` → `data.attributes.urls.customer_portal`.
     * It is a pre-signed link (valid for 24 hours), and **the field is null when the customer has
     * no subscriptions** — the caller openPortal returns no_customer for "this user has no
     * customer record yet", which is a different edge case (here the customer record exists but
     * all subscriptions have ended), so all we can do is throw a clear error and let the user
     * sort it out in the provider's portal or by ordering again.
     */
    async getPortalUrl(customerId: string): Promise<string> {
      const document = await lemonSqueezy.request(
        "GET",
        `/v1/customers/${encodeURIComponent(customerId)}`,
      );
      const attributes = asObject(
        asObject(asObject(document)?.data)?.attributes,
      );
      const urls = asObject(attributes?.urls);
      const portalUrl = asString(urls?.customer_portal);
      if (!portalUrl) {
        throw new Error(
          `Lemon Squeezy customer ${customerId} has no customer_portal url (no active subscription)`,
        );
      }
      return portalUrl;
    },

    /**
     * Cancels a subscription: `DELETE /v1/subscriptions/:id` cancels **future charges**, and the
     * user keeps access until `ends_at`. That's the right semantics for "stop renewals before
     * deleting the account" (canceling immediately would also take away the period the user
     * already paid for).
     * Already cancelled / expired, or subscription not found (404), all count as success, matching
     * creem.ts, so retries are safe.
     */
    async cancelSubscription(subscriptionId: string): Promise<void> {
      try {
        const document = await lemonSqueezy.request(
          "GET",
          `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
        );
        const status = asString(
          asObject(asObject(asObject(document)?.data)?.attributes)?.status,
        );
        if (status === "cancelled" || status === "expired") return;
        await lemonSqueezy.request(
          "DELETE",
          `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
        );
      } catch (error) {
        if (error instanceof LemonSqueezyApiError && error.status === 404)
          return;
        throw error;
      }
    },

    /**
     * Lemon Squeezy has no official signature verification helper, so this is hand-written
     * following the official Node example: the `X-Signature` header is the **hex** digest of an
     * HMAC-SHA256 (keyed with the webhook's signing secret), and it must be verified against the
     * **raw body** (`await request.text()`; never JSON.parse and re-serialize first).
     */
    async verifyWebhook(request: Request): Promise<unknown> {
      const body = await request.text();
      const signature = request.headers.get(WEBHOOK_SIGNATURE_HEADER);
      if (!signature) {
        throw new WebhookVerificationError("Missing X-Signature header");
      }
      const expected = Buffer.from(
        createHmac("sha256", webhookSecret).update(body).digest("hex"),
      );
      const actual = Buffer.from(signature);
      // timingSafeEqual throws on buffers of different lengths, so compare lengths first (different
      // lengths can never match).
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      ) {
        throw new WebhookVerificationError();
      }
      try {
        return JSON.parse(body);
      } catch {
        throw new WebhookVerificationError("Invalid webhook body");
      }
    },

    parseEvent: parseLemonSqueezyEvent,
  };
}

/** Signature header name; see the Lemon Squeezy webhook docs. */
const WEBHOOK_SIGNATURE_HEADER = "X-Signature";

function planVariantId(planId: string) {
  const plan = getPlan(planId);
  if (!plan?.providerProductId) {
    throw new Error(`Plan "${planId}" has no providerProductId`);
  }
  // Lemon Squeezy checkout uses the variant ID, not the product ID: under lemonsqueezy, the
  // providerProductId in site.config.ts holds LEMONSQUEEZY_VARIANT_ID_*.
  return plan.providerProductId;
}
