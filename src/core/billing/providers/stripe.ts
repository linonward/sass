import Stripe from "stripe";

import { siteUrl } from "../../seo/urls";
import type { BillingEvent } from "../events";
import { getPlan, planByProductId } from "../plans";
import {
  WebhookVerificationError,
  type Checkout,
  type CreateCheckoutInput,
  type PaymentProvider,
} from "../provider";

export const STRIPE_PROVIDER_ID = "stripe";

/**
 * Return path for the customer portal: the portal is opened from the in-app billing page, so it
 * returns to that same page.
 */
const PORTAL_RETURN_PATH = "/billing";

/*
 * Stripe webhook → BillingEvent mapping (event type list:
 * https://docs.stripe.com/api/events/types):
 *
 * | Stripe event                                | BillingEvent         | Notes                                                    |
 * | ------------------------------------------- | -------------------- | -------------------------------------------------------- |
 * | checkout.session.completed (mode=payment)   | checkout.completed   | orderId is payment_intent; carries amount_total / currency |
 * | checkout.session.completed (subscription)   | checkout.completed   | No orderId: subscription money is recorded by invoice.paid (one order per payment) |
 * | invoice.paid                                | subscription.renewed | Records both the first period and renewals; orderId is invoice.id, amount is amount_paid |
 * | invoice.payment_failed                      | payment.failed       | orderId is also invoice.id: a successful retry merges back into the same order |
 * | customer.subscription.updated               | Dispatched by status, see parseSubscriptionEvent                                |
 * | customer.subscription.deleted               | subscription.expired | The subscription has ended (canceled immediately, or canceled at period end and expired) |
 * | Others (charge.refunded, charge.dispute.*, etc.) | Ignored (returns null)                                                     |
 *
 * The order ID convention matches Creem: one payment maps to one order. Each subscription period
 * uses invoice.id as the order number, and the subscription checkout branch carries no orderId,
 * so the first period is never recorded as two orders (double-recording would inflate revenue in
 * src/core/admin/metrics.ts).
 * Subscription metadata is a snapshot taken when the invoice is finalized, so renewal events can
 * still find userId / planId via parent.subscription_details.metadata; when they can't, the plan
 * is looked up by the Price ID on the invoice line.
 *
 * **v1 does not handle refunds**: Stripe's refund object has no invoice field, and Charge /
 * PaymentIntent no longer expose the invoice either, so mapping a refund back to an order would
 * require custom metadata or the Invoice Payment API (invoice_payment.payment.payment_intent, only
 * available for invoices finalized after 2019-03-15). That path would leak Stripe-specific
 * structure into the orders table and the revenue stats in src/core/admin/metrics.ts, so refund
 * events are always ignored (Creem reclaiming credits on refund is its own path; see the
 * "Payments" section of the README).
 *
 * Time: Stripe's created / current_period_* are Unix seconds; multiply by 1000 to get a Date.
 * Amounts: in the smallest currency unit (cents), consistent with events.ts.
 */

type Loose = Record<string, unknown>;

const asObject = (value: unknown): Loose | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Loose)
    : undefined;
const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;
const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
/** Stripe timestamps are Unix seconds. */
const asTimestamp = (value: unknown): Date | undefined => {
  const seconds = asNumber(value);
  if (seconds === undefined) return undefined;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date;
};
/** Stripe sometimes expands related objects and sometimes gives only the ID. */
const idOf = (value: unknown): string | undefined =>
  asString(value) ?? asString(asObject(value)?.id);

/**
 * Metadata written at checkout: { userId, planId }. Subscriptions get a copy via
 * subscription_data.metadata.
 */
function metadataOf(...sources: unknown[]) {
  for (const source of sources) {
    const metadata = asObject(asObject(source)?.metadata);
    if (metadata?.userId || metadata?.planId) {
      return {
        userId: asString(metadata.userId),
        planId: asString(metadata.planId),
      };
    }
  }
  return { userId: undefined, planId: undefined };
}

/**
 * The Price ID on an invoice line: the current API puts it at pricing.price_details.price (the
 * top-level price was removed).
 */
function lineItemPriceId(line: Loose | undefined) {
  const details = asObject(asObject(line?.pricing)?.price_details);
  return idOf(details?.price);
}

/**
 * The **service period** this bill covers. In the current API, invoice.period_start / period_end
 * are only "the time range in which invoice items can be associated with this invoice" (see
 * https://docs.stripe.com/api/invoices/object); the real service period is on the invoice line's
 * period, and we fall back to the invoice fields only when there is no line.
 */
function servicePeriod(line: Loose | undefined, invoice: Loose) {
  const period = asObject(line?.period);
  return {
    currentPeriodStart: asTimestamp(period?.start ?? invoice.period_start),
    currentPeriodEnd: asTimestamp(period?.end ?? invoice.period_end),
  };
}

/**
 * The planId in metadata wins; otherwise look up the plan by Price ID (price on a subscription
 * item, pricing on an invoice line).
 */
function planIdOf(
  metadataPlanId: string | undefined,
  ...prices: unknown[]
): string | undefined {
  if (metadataPlanId) return metadataPlanId;
  for (const price of prices) {
    const priceId = idOf(price);
    const plan = priceId ? planByProductId(priceId) : undefined;
    if (plan) return plan.id;
  }
  return undefined;
}

type EventBase = Pick<
  BillingEvent,
  "provider" | "eventId" | "occurredAt" | "raw"
>;

/**
 * Converts a verified Stripe webhook body into a BillingEvent; returns null for events we don't
 * care about.
 */
export function parseStripeEvent(payload: unknown): BillingEvent | null {
  const event = asObject(payload);
  const object = asObject(asObject(event?.data)?.object);
  const eventId = asString(event?.id);
  const type = asString(event?.type);
  if (!event || !object || !eventId || !type) return null;

  const base: EventBase = {
    provider: STRIPE_PROVIDER_ID,
    eventId,
    occurredAt: asTimestamp(event.created) ?? new Date(),
    raw: payload,
  };

  switch (type) {
    case "checkout.session.completed":
      return parseCheckoutSession(base, object);
    case "invoice.paid":
    case "invoice.payment_failed":
      return parseInvoiceEvent(type, base, object);
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return parseSubscriptionEvent(type, base, object);
    default:
      return null;
  }
}

function parseCheckoutSession(
  base: EventBase,
  session: Loose,
): BillingEvent | null {
  const checkoutId = asString(session.id);
  if (!checkoutId) return null;
  const { userId, planId } = metadataOf(session);
  // Subscription checkouts carry no order: the money is recorded in invoice.paid (mode is one of
  // payment / setup / subscription, and our checkouts only ever use payment and subscription).
  const oneTime = asString(session.mode) !== "subscription";
  return {
    ...base,
    type: "checkout.completed",
    userId,
    customerId: idOf(session.customer),
    checkoutId,
    planId,
    // One-time payments use the PaymentIntent as the order number (or the checkout session ID if
    // there is none).
    orderId: oneTime ? (idOf(session.payment_intent) ?? checkoutId) : undefined,
    subscriptionId: idOf(session.subscription),
    amount: oneTime ? asNumber(session.amount_total) : undefined,
    currency: oneTime ? asString(session.currency) : undefined,
  };
}

function parseInvoiceEvent(
  eventType: string,
  base: EventBase,
  invoice: Loose,
): BillingEvent | null {
  const orderId = asString(invoice.id);
  const parent = asObject(invoice.parent);
  const details = asObject(parent?.subscription_details);
  const subscriptionId = idOf(details?.subscription);
  // Only handle invoices issued by subscriptions: v1 records no order for one-off invoices (parent
  // empty or pointing at a quote).
  if (
    !orderId ||
    !details ||
    !subscriptionId ||
    asString(parent?.type) !== "subscription_details"
  ) {
    return null;
  }

  const { userId, planId } = metadataOf(details);
  const firstLine = asObject(asArray(asObject(invoice.lines)?.data)[0]);
  const common = {
    ...base,
    userId,
    customerId: idOf(invoice.customer),
    subscriptionId,
    orderId,
    amount: asNumber(
      eventType === "invoice.paid" ? invoice.amount_paid : invoice.amount_due,
    ),
    currency: asString(invoice.currency),
  };

  if (eventType === "invoice.paid") {
    return {
      ...common,
      type: "subscription.renewed",
      planId: planIdOf(planId, lineItemPriceId(firstLine)),
      ...servicePeriod(firstLine, invoice),
    };
  }
  return { ...common, type: "payment.failed" };
}

function parseSubscriptionEvent(
  eventType: string,
  base: EventBase,
  subscription: Loose,
): BillingEvent | null {
  const subscriptionId = asString(subscription.id);
  if (!subscriptionId) return null;

  // The current API (2026-08-26.dahlia) moved the billing period from the subscription to the
  // subscription items: subscription.current_period_* no longer exists, so read items.data[0].
  const item = asObject(asArray(asObject(subscription.items)?.data)[0]);
  const { userId, planId } = metadataOf(subscription);
  const common = {
    ...base,
    userId,
    customerId: idOf(subscription.customer),
    subscriptionId,
  };
  const period = {
    currentPeriodStart: asTimestamp(item?.current_period_start),
    currentPeriodEnd: asTimestamp(item?.current_period_end),
  };

  if (eventType === "customer.subscription.deleted") {
    // deleted is terminal: the subscription has ended (canceled immediately, or
    // cancel_at_period_end reached). Record it as expired rather than canceled — canceled means
    // "still usable until currentPeriodEnd", and on an immediate cancel Stripe first sends an
    // updated event with status=canceled, which has already been recorded as canceled.
    return { ...common, type: "subscription.expired" };
  }

  switch (asString(subscription.status)) {
    case "active":
    case "trialing":
      // Scheduled to cancel at period end: status is still active but renewal has stopped → treat
      // as canceled and include the time access lasts until.
      return subscription.cancel_at_period_end === true
        ? {
            ...common,
            type: "subscription.canceled",
            currentPeriodEnd: period.currentPeriodEnd,
          }
        : {
            ...common,
            ...period,
            type: "subscription.active",
            planId: planIdOf(planId, item?.price),
          };
    case "past_due":
    case "unpaid":
      // Charge failed (Stripe retries on its own); the order is recorded by invoice.payment_failed.
      return { ...common, type: "payment.failed" };
    case "canceled":
      return {
        ...common,
        type: "subscription.canceled",
        currentPeriodEnd: period.currentPeriodEnd,
      };
    default:
      // incomplete / incomplete_expired / paused / ended: not handled in v1.
      return null;
  }
}

/** The SDK methods we use; tests can inject a fake implementation. */
export type StripeClient = {
  checkout: { sessions: Pick<Stripe["checkout"]["sessions"], "create"> };
  billingPortal: {
    sessions: Pick<Stripe["billingPortal"]["sessions"], "create">;
  };
  subscriptions: Pick<Stripe["subscriptions"], "retrieve" | "cancel">;
  webhooks: Pick<Stripe["webhooks"], "constructEvent">;
  errors: Stripe["errors"];
};

export type StripeProviderOptions = {
  secretKey: string;
  webhookSecret: string;
  /**
   * Injected by tests; defaults to an official SDK client built from secretKey (apiVersion uses
   * the SDK's built-in default).
   */
  client?: StripeClient;
};

export function createStripeProvider({
  secretKey,
  webhookSecret,
  client,
}: StripeProviderOptions): PaymentProvider {
  const stripe: StripeClient = client ?? new Stripe(secretKey);

  return {
    id: STRIPE_PROVIDER_ID,

    async createCheckout(input: CreateCheckoutInput): Promise<Checkout> {
      const plan = planForCheckout(input.planId);
      const metadata = { userId: input.userId, planId: input.planId };
      const session = await stripe.checkout.sessions.create({
        // subscription for subscriptions, payment for one-time purchases.
        mode: plan.subscription ? "subscription" : "payment",
        line_items: [{ price: plan.priceId, quantity: 1 }],
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        client_reference_id: input.userId,
        metadata,
        // Subscriptions need an extra copy: the Session's metadata is **not** copied to the
        // subscription, only subscription_data.metadata is. The webhook relies on it to find the
        // user and plan.
        ...(plan.subscription && { subscription_data: { metadata } }),
        ...(input.customerEmail && { customer_email: input.customerEmail }),
      });
      // No Idempotency-Key: duplicate checkouts are handled by reuse and mutual exclusion in the
      // checkout_sessions table (see ../checkout.ts).
      if (!session.url) {
        throw new Error("Stripe checkout session has no url");
      }
      return { checkoutId: session.id, url: session.url };
    },

    async getPortalUrl(customerId: string): Promise<string> {
      // Stripe's customer portal requires a return_url (Creem's generateBillingLinks doesn't).
      // There's no Request here, so return to the billing page via the site's own absolute URL
      // (the same source as canonical); localePrefix is as-needed, so the default locale has no
      // prefix.
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${siteUrl}${PORTAL_RETURN_PATH}`,
      });
      return session.url;
    },

    /**
     * Cancels immediately. A subscription that will never be charged again counts as success
     * (this gets retried later, so a terminal state must not raise an error).
     */
    async cancelSubscription(subscriptionId: string): Promise<void> {
      try {
        const current = await stripe.subscriptions.retrieve(subscriptionId);
        if (isTerminal(current.status)) return;
        await stripe.subscriptions.cancel(subscriptionId);
      } catch (error) {
        if (isNotFound(error)) return;
        throw error;
      }
    },

    async verifyWebhook(request: Request): Promise<unknown> {
      // body must be the raw string: the signature is an HMAC over the received bytes, and
      // JSON.parse followed by re-serializing would change the bytes.
      const body = await request.text();
      const signature = request.headers.get("stripe-signature") ?? "";
      try {
        // The synchronous constructEvent uses node:crypto (NodeCryptoProvider). Our webhook route
        // runs on the Node.js runtime (src/app/api/webhooks/stripe/route.ts), and stripe-node's
        // official Next.js App Router example also uses the sync version;
        // constructEventAsync + createSubtleCryptoProvider() is only for runtimes without
        // node:crypto (Cloudflare Workers / edge), where the sync version throws
        // CryptoProviderOnlySupportsAsyncError. The tolerance window is the SDK default of 300s.
        return stripe.webhooks.constructEvent(body, signature, webhookSecret);
      } catch (error) {
        if (error instanceof stripe.errors.StripeSignatureVerificationError) {
          throw new WebhookVerificationError(error.message);
        }
        // With a valid signature but a body that isn't valid JSON, constructEvent throws a
        // SyntaxError (not a signature error); such a request is malformed, so it is also treated
        // as failing verification: nothing is written and it isn't retried.
        if (error instanceof SyntaxError) {
          throw new WebhookVerificationError("Invalid webhook body");
        }
        throw error;
      }
    },

    parseEvent: parseStripeEvent,
  };
}

/** Stripe's "no such object" error (404). */
function isNotFound(error: unknown) {
  return (
    error instanceof Stripe.errors.StripeInvalidRequestError &&
    error.statusCode === 404
  );
}

/**
 * Statuses that will never be charged again and so can't be canceled (see status on
 * https://docs.stripe.com/api/subscriptions/object).
 * canceled: already ended; incomplete_expired: the first period was never paid and the invoice
 * was voided, a terminal state.
 * All other statuses (active / trialing / past_due / unpaid / paused / incomplete) can still be
 * canceled.
 */
function isTerminal(status: string) {
  return status === "canceled" || status === "incomplete_expired";
}

/**
 * Plan info needed for checkout: the product ID is required (free plans have none, so they can't
 * be checked out).
 */
function planForCheckout(planId: string) {
  const plan = getPlan(planId);
  if (!plan?.providerProductId) {
    throw new Error(`Plan "${planId}" has no providerProductId`);
  }
  return {
    priceId: plan.providerProductId,
    subscription: plan.type === "subscription",
  };
}
