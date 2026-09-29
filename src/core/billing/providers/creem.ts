import { Creem } from "creem";
import { APIError } from "creem/models/errors";
import {
  verifyWebhookSignature,
  WebhookVerificationError as CreemSignatureError,
} from "creem/webhooks";

import type { BillingEvent } from "../events";
import { getPlan, planByProductId } from "../plans";
import {
  WebhookVerificationError,
  type Checkout,
  type CreateCheckoutInput,
  type PaymentProvider,
} from "../provider";
import type { CreemMode } from "../env";

export const CREEM_PROVIDER_ID = "creem";

/*
 * Creem webhook → BillingEvent mapping (event shapes: https://docs.creem.io/code/webhooks):
 *
 * | Creem eventType                 | BillingEvent          | Notes                                                        |
 * | ------------------------------- | --------------------- | ------------------------------------------------------------ |
 * | checkout.completed              | checkout.completed    | One-time purchases carry orderId (ord_); subscription checkouts have no order |
 * | subscription.active             | subscription.active   | Syncs status only, grants no credits                         |
 * | subscription.paid               | subscription.renewed  | Every period's payment (incl. the first); orderId is last_transaction_id |
 * | subscription.scheduled_cancel   | subscription.canceled | Renewal canceled, still usable until current_period_end      |
 * | subscription.canceled           | subscription.canceled |                                                              |
 * | subscription.update (active)    | subscription.active   | Renewal resumed (scheduled_cancel undone); other statuses ignored |
 * | subscription.expired            | subscription.expired  |                                                              |
 * | subscription.past_due / unpaid  | payment.failed        |                                                              |
 * | refund.created                  | refund.created        | Subscription payments map to the order by transaction.id, one-time by order |
 * | Others (dispute, trialing, paused, credits.*, etc.) | Ignored (returns null) |                                         |
 *
 * Order ID convention: one-time purchases use Creem's order.id; each subscription payment uses
 * transaction.id (subscription.paid only carries last_transaction_id, not an order). Refunds find
 * the matching order by the same rule.
 * Amounts are in the smallest currency unit (cents), same as Creem.
 */

type Loose = Record<string, unknown>;

type CreemWebhookPayload = {
  id: string;
  eventType: string;
  created_at: number;
  object: Loose;
};

const asObject = (value: unknown): Loose | undefined =>
  value && typeof value === "object" ? (value as Loose) : undefined;
const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;
const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const asDate = (value: unknown): Date | undefined => {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};
/** Creem sometimes expands related objects and sometimes gives only the ID. */
const idOf = (value: unknown): string | undefined =>
  asString(value) ?? asString(asObject(value)?.id);

/**
 * Metadata written at checkout: { userId, planId }. Subscriptions copy the checkout's metadata.
 */
function metadataOf(...sources: unknown[]) {
  for (const source of sources) {
    const metadata = asObject(asObject(source)?.metadata);
    if (metadata && (metadata.userId || metadata.planId)) {
      return {
        userId: asString(metadata.userId),
        planId: asString(metadata.planId),
      };
    }
  }
  return { userId: undefined, planId: undefined };
}

function planIdOf(metadataPlanId: string | undefined, product: unknown) {
  if (metadataPlanId) return metadataPlanId;
  const productId = idOf(product);
  return productId ? planByProductId(productId)?.id : undefined;
}

/**
 * Converts a verified Creem webhook body into a BillingEvent; returns null for events we don't
 * care about.
 */
export function parseCreemEvent(payload: unknown): BillingEvent | null {
  const data = asObject(payload) as CreemWebhookPayload | undefined;
  const object = asObject(data?.object);
  if (!data || !object || !asString(data.id) || !asString(data.eventType)) {
    return null;
  }

  const base = {
    provider: CREEM_PROVIDER_ID,
    eventId: data.id,
    occurredAt: asDate(data.created_at) ?? new Date(),
    raw: payload,
  };

  switch (data.eventType) {
    case "checkout.completed": {
      const order = asObject(object.order);
      const subscriptionId = idOf(object.subscription);
      const { userId, planId } = metadataOf(object, object.subscription);
      return {
        ...base,
        type: "checkout.completed",
        userId,
        customerId: idOf(object.customer) ?? asString(order?.customer),
        checkoutId: asString(object.id)!,
        planId: planIdOf(planId, object.product ?? order?.product),
        // Subscription payments are recorded per transaction by subscription.paid; only one-time
        // purchase orders are recorded here.
        orderId: subscriptionId ? undefined : asString(order?.id),
        subscriptionId,
        amount: asNumber(order?.amount),
        currency: asString(order?.currency),
      };
    }

    case "subscription.active":
    case "subscription.update":
    case "subscription.paid":
    case "subscription.scheduled_cancel":
    case "subscription.canceled":
    case "subscription.expired":
    case "subscription.past_due":
    case "subscription.unpaid":
      return parseSubscriptionEvent(data.eventType, base, object);

    case "refund.created": {
      const transaction = asObject(object.transaction);
      const { userId } = metadataOf(object.checkout, object.subscription);
      const orderId = asString(transaction?.subscription)
        ? asString(transaction?.id)
        : (asString(transaction?.order) ?? idOf(object.order));
      const refundId = asString(object.id);
      const amount = asNumber(object.refund_amount);
      const currency = asString(object.refund_currency);
      if (!orderId || !refundId || amount === undefined || !currency) {
        return null;
      }
      return {
        ...base,
        type: "refund.created",
        userId,
        customerId: idOf(object.customer),
        orderId,
        refundId,
        amount,
        currency,
      };
    }

    default:
      return null;
  }
}

function parseSubscriptionEvent(
  eventType: string,
  base: Pick<BillingEvent, "provider" | "eventId" | "occurredAt" | "raw">,
  object: Loose,
): BillingEvent | null {
  const subscriptionId = asString(object.id);
  if (!subscriptionId) return null;
  const { userId, planId } = metadataOf(object);
  const product = asObject(object.product);
  const common = {
    ...base,
    userId,
    customerId: idOf(object.customer),
    subscriptionId,
  };
  const period = {
    currentPeriodStart: asDate(object.current_period_start_date),
    currentPeriodEnd: asDate(object.current_period_end_date),
  };
  const plan = planIdOf(planId, object.product);

  switch (eventType) {
    case "subscription.active":
      return {
        ...common,
        ...period,
        type: "subscription.active",
        planId: plan,
      };
    case "subscription.update":
      // Only resumed renewals matter; v1 ignores other changes (quantity changes, etc.).
      return object.status === "active"
        ? { ...common, ...period, type: "subscription.active", planId: plan }
        : null;
    case "subscription.paid":
      return {
        ...common,
        ...period,
        type: "subscription.renewed",
        planId: plan,
        orderId: asString(object.last_transaction_id),
        // subscription.paid doesn't carry the amount actually paid, so use the product's list price
        // (excluding tax and discounts) as an approximation.
        amount: asNumber(product?.price),
        currency: asString(product?.currency),
      };
    case "subscription.scheduled_cancel":
    case "subscription.canceled":
      return {
        ...common,
        type: "subscription.canceled",
        currentPeriodEnd: period.currentPeriodEnd,
      };
    case "subscription.expired":
      return { ...common, type: "subscription.expired" };
    case "subscription.past_due":
    case "subscription.unpaid":
      return { ...common, type: "payment.failed" };
    default:
      return null;
  }
}

/** The SDK methods we use; tests can inject a fake implementation. */
export type CreemClient = {
  checkouts: Pick<Creem["checkouts"], "create">;
  customers: Pick<Creem["customers"], "generateBillingLinks">;
  subscriptions: Pick<Creem["subscriptions"], "get" | "cancel">;
};

export type CreemProviderOptions = {
  apiKey: string;
  webhookSecret: string;
  mode: CreemMode;
  /** Injected by tests; defaults to an official SDK client built from apiKey and mode. */
  client?: CreemClient;
};

export function createCreemProvider({
  apiKey,
  webhookSecret,
  mode,
  client,
}: CreemProviderOptions): PaymentProvider {
  const creem: CreemClient =
    client ??
    new Creem({ apiKey, ...(mode === "test" && { server: "test" as const }) });

  return {
    id: CREEM_PROVIDER_ID,

    async createCheckout(input: CreateCheckoutInput): Promise<Checkout> {
      const productId = planProductId(input.planId);
      const checkout = await creem.checkouts.create({
        productId,
        requestId: `${input.userId}:${input.planId}`,
        successUrl: input.successUrl,
        // Creem checkout has no cancel URL: the user just closes the page, so input.cancelUrl is
        // unused.
        ...(input.customerEmail && {
          customer: { email: input.customerEmail },
        }),
        metadata: { userId: input.userId, planId: input.planId },
      });
      if (!checkout.checkoutUrl) {
        throw new Error("Creem checkout has no checkout_url");
      }
      return { checkoutId: checkout.id, url: checkout.checkoutUrl };
    },

    async getPortalUrl(customerId: string): Promise<string> {
      const links = await creem.customers.generateBillingLinks({ customerId });
      return links.customerPortalLink;
    },

    /**
     * Cancels immediately. Already canceled, already scheduled to cancel at period end, or not
     * found all count as success (no further charges will happen), so retries are safe.
     */
    async cancelSubscription(subscriptionId: string): Promise<void> {
      try {
        const current = await creem.subscriptions.get(subscriptionId);
        if (
          current.status === "canceled" ||
          current.status === "scheduled_cancel"
        )
          return;
        await creem.subscriptions.cancel(subscriptionId, { mode: "immediate" });
      } catch (error) {
        if (error instanceof APIError && error.statusCode === 404) return;
        throw error;
      }
    },

    async verifyWebhook(request: Request): Promise<unknown> {
      const body = await request.text();
      try {
        await verifyWebhookSignature(body, request.headers, {
          secret: webhookSecret,
        });
      } catch (error) {
        if (error instanceof CreemSignatureError) {
          throw new WebhookVerificationError(error.message);
        }
        throw error;
      }
      try {
        return JSON.parse(body);
      } catch {
        throw new WebhookVerificationError("Invalid webhook body");
      }
    },

    parseEvent: parseCreemEvent,
  };
}

function planProductId(planId: string) {
  const plan = getPlan(planId);
  if (!plan?.providerProductId) {
    throw new Error(`Plan "${planId}" has no providerProductId`);
  }
  return plan.providerProductId;
}
