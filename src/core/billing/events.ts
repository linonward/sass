/**
 * 归一化的账单事件。各支付服务商的 parseEvent() 把自己的 webhook 转换成这里的类型，
 * 下游（handleBillingEvent、onBillingEvent 钩子）只和它打交道。
 * 金额以最小货币单位（分）计；时间都是 Date。
 */
type EventBase = {
  /** 服务商 ID，例如 "creem"。 */
  provider: string;
  /** 服务商给的事件 ID，(provider, eventId) 用于幂等。 */
  eventId: string;
  /** 事件在服务商那边发生的时间，用于判断乱序。 */
  occurredAt: Date;
  /** 创建结账时传给服务商的用户 ID（metadata），有就优先用它。 */
  userId?: string;
  /** 服务商的客户 ID；没有 userId 时按它查 billing_customers。 */
  customerId?: string;
  /** 服务商的原始数据。 */
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
    /** 一次性购买或订阅首付产生的订单。 */
    orderId?: string;
    /** 订阅结账时的订阅 ID；订阅状态由 subscription.* 事件维护。 */
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
    /** 这次续费扣款对应的订单。 */
    orderId?: string;
  };

export type SubscriptionCanceledEvent = EventBase & {
  type: "subscription.canceled";
  subscriptionId: string;
  /** 取消后仍可使用到这个时间。 */
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
