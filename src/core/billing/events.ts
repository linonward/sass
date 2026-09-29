/**
 * Normalized billing events. Each payment provider's parseEvent() turns its webhooks into these types,
 * and downstream code (handleBillingEvent, onBillingEvent hooks) only deals with them.
 * Amounts are in the smallest currency unit (cents); all times are Dates.
 */
type EventBase = {
  /** Provider ID, e.g. "creem". */
  provider: string;
  /** Event ID from the provider; (provider, eventId) is used for idempotency. */
  eventId: string;
  /** When the event happened at the provider; used to detect out-of-order delivery. */
  occurredAt: Date;
  /** User ID passed to the provider (as metadata) when creating checkout; preferred when present. */
  userId?: string;
  /** Provider's customer ID; used to look up billing_customers when there's no userId. */
  customerId?: string;
  /** Raw data from the provider. */
  raw: unknown;
};

type Money = { amount?: number; currency?: string };

type SubscriptionPeriod = {
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
};

export type CheckoutCompletedEvent = EventBase &
  Money & {
    type: "checkout.completed";
    checkoutId: string;
    planId?: string;
    /** Order created by a one-time purchase or the first subscription payment. */
    orderId?: string;
    /**
     * Subscription ID at subscription checkout; subscription state is maintained by subscription.*
     * events.
     */
    subscriptionId?: string;
  };

export type SubscriptionActiveEvent = EventBase &
  SubscriptionPeriod & {
    type: "subscription.active";
    subscriptionId: string;
    planId?: string;
  };

export type SubscriptionRenewedEvent = EventBase &
  SubscriptionPeriod &
  Money & {
    type: "subscription.renewed";
    subscriptionId: string;
    planId?: string;
    /** Order for this renewal charge. */
    orderId?: string;
  };

export type SubscriptionCanceledEvent = EventBase & {
  type: "subscription.canceled";
  subscriptionId: string;
  /** Still usable until this time after cancellation. */
  currentPeriodEnd?: Date;
};

export type SubscriptionExpiredEvent = EventBase & {
  type: "subscription.expired";
  subscriptionId: string;
};

export type PaymentFailedEvent = EventBase &
  Money & {
    type: "payment.failed";
    subscriptionId?: string;
    orderId?: string;
  };

export type RefundCreatedEvent = EventBase &
  Required<Money> & {
    type: "refund.created";
    orderId: string;
    refundId: string;
  };

export type BillingEvent =
  | CheckoutCompletedEvent
  | SubscriptionActiveEvent
  | SubscriptionRenewedEvent
  | SubscriptionCanceledEvent
  | SubscriptionExpiredEvent
  | PaymentFailedEvent
  | RefundCreatedEvent;

export type BillingEventType = BillingEvent["type"];

export const billingEventTypes = [
  "checkout.completed",
  "subscription.active",
  "subscription.renewed",
  "subscription.canceled",
  "subscription.expired",
  "payment.failed",
  "refund.created",
] as const satisfies readonly BillingEventType[];
