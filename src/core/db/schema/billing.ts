// Payment tables. Only provider-agnostic fields live here; the provider's raw data is stored in raw
// (jsonb). Foreign keys to user.id all cascade: before an account is deleted the onUserDelete hook
// cancels its subscriptions, and then the billing records are deleted along with the user.
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const timestamps = {
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
};

const userId = () =>
  text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" });

/** The user's customer ID at the payment provider. One customer per user per provider. */
export const billingCustomers = pgTable(
  "billing_customers",
  {
    id: id(),
    userId: userId(),
    provider: text("provider").notNull(),
    providerCustomerId: text("provider_customer_id").notNull(),
    raw: jsonb("raw"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("billing_customers_provider_user_idx").on(t.provider, t.userId),
    uniqueIndex("billing_customers_provider_customer_idx").on(
      t.provider,
      t.providerCustomerId,
    ),
  ],
);

export const subscriptionStatuses = [
  "active",
  "past_due",
  "canceled",
  "expired",
] as const;
export type SubscriptionStatus = (typeof subscriptionStatuses)[number];

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: id(),
    userId: userId(),
    provider: text("provider").notNull(),
    providerSubscriptionId: text("provider_subscription_id").notNull(),
    providerCustomerId: text("provider_customer_id"),
    planId: text("plan_id"),
    status: text("status", { enum: subscriptionStatuses }).notNull(),
    currentPeriodStart: timestamp("current_period_start"),
    currentPeriodEnd: timestamp("current_period_end"),
    // canceled means renewal was canceled; still usable until currentPeriodEnd, after which it ends
    // as expired.
    canceledAt: timestamp("canceled_at"),
    endedAt: timestamp("ended_at"),
    // Time of the event that last changed the status, used to discard stale events arriving out
    // of order.
    lastEventAt: timestamp("last_event_at").notNull(),
    raw: jsonb("raw"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("subscriptions_provider_subscription_idx").on(
      t.provider,
      t.providerSubscriptionId,
    ),
    index("subscriptions_user_idx").on(t.userId),
  ],
);

export const orderStatuses = [
  "failed",
  "paid",
  "partially_refunded",
  "refunded",
] as const;
export type OrderStatus = (typeof orderStatuses)[number];

/**
 * One payment: a one-time purchase, or a subscription's first payment or any renewal. Amounts are
 * in the smallest currency unit (cents).
 */
export const orders = pgTable(
  "orders",
  {
    id: id(),
    userId: userId(),
    provider: text("provider").notNull(),
    providerOrderId: text("provider_order_id").notNull(),
    providerSubscriptionId: text("provider_subscription_id"),
    planId: text("plan_id"),
    status: text("status", { enum: orderStatuses }).notNull(),
    amount: integer("amount"),
    currency: text("currency"),
    // Exact billing grant ledger key; immutable across later refunds and plan edits.
    creditGrantSourceId: text("credit_grant_source_id"),
    refundedAmount: integer("refunded_amount").default(0).notNull(),
    raw: jsonb("raw"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("orders_provider_order_idx").on(t.provider, t.providerOrderId),
    index("orders_user_idx").on(t.userId),
    // Admin metrics sum revenue by time range.
    index("orders_created_idx").on(t.createdAt),
  ],
);

/**
 * Processed webhook events. (provider, event_id) is unique, so a redelivered event is handled only
 * once.
 */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: id(),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    type: text("type").notNull(),
    occurredAt: timestamp("occurred_at").notNull(),
    // A newer state already existed when the event arrived, so it didn't change the subscription or
    // order.
    stale: boolean("stale").default(false).notNull(),
    processedAt: timestamp("processed_at").defaultNow().notNull(),
    raw: jsonb("raw"),
  },
  (t) => [
    uniqueIndex("webhook_events_provider_event_idx").on(t.provider, t.eventId),
  ],
);

/**
 * The most recently created checkout session. Used to **dedupe** concurrent or repeated checkout
 * requests: the same (user, plan) reuses one session URL while it's valid, instead of creating a
 * new one at the provider.
 *
 * Why we have to store it ourselves: Creem's `request_id` is not an idempotency key — sending the
 * same request_id twice in a row was observed to return two separately payable sessions. And a
 * "just created checkout session" leaves no trace in the subscription / order tables (that waits
 * for the payment webhook), so checking those alone can't stop a double click.
 */
export const checkoutSessions = pgTable(
  "checkout_sessions",
  {
    id: id(),
    userId: userId(),
    provider: text("provider").notNull(),
    planId: text("plan_id").notNull(),
    providerSessionId: text("provider_session_id").notNull(),
    url: text("url").notNull(),
    // Not reused after expiry; the next checkout creates a new session.
    expiresAt: timestamp("expires_at").notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("checkout_sessions_user_plan_idx").on(t.userId, t.planId),
  ],
);
