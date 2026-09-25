// 收款相关的表。只放与服务商无关的通用字段，服务商的原始数据存在 raw（jsonb）里。
// 引用 user.id 的外键都是 cascade：删除账户前由 onUserDelete 钩子取消订阅（T303），
// 之后账单记录随用户一起删除。
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

/** 用户在支付服务商那边的客户 ID。每个服务商下一个用户对应一个客户。 */
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
    // canceled 表示已取消续费；到 currentPeriodEnd 之前仍可使用，之后由 expired 结束。
    canceledAt: timestamp("canceled_at"),
    endedAt: timestamp("ended_at"),
    // 最近一次改变状态的事件时间，用来丢弃乱序到达的旧事件。
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

/** 一次付款：一次性购买，或者订阅的首付与每次续费。金额以最小货币单位（分）计。 */
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
    refundedAmount: integer("refunded_amount").default(0).notNull(),
    raw: jsonb("raw"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("orders_provider_order_idx").on(t.provider, t.providerOrderId),
    index("orders_user_idx").on(t.userId),
    // 后台指标按时间区间统计收入。
    index("orders_created_idx").on(t.createdAt),
  ],
);

/** 已处理的 webhook 事件，(provider, event_id) 唯一，保证重复推送只处理一次。 */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: id(),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    type: text("type").notNull(),
    occurredAt: timestamp("occurred_at").notNull(),
    // 事件到达时已有更新的状态，因此没有改动订阅或订单。
    stale: boolean("stale").default(false).notNull(),
    processedAt: timestamp("processed_at").defaultNow().notNull(),
    raw: jsonb("raw"),
  },
  (t) => [
    uniqueIndex("webhook_events_provider_event_idx").on(t.provider, t.eventId),
  ],
);
