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
 * Creem webhook → BillingEvent 映射（事件结构见 https://docs.creem.io/code/webhooks）：
 *
 * | Creem eventType                | BillingEvent            | 说明                                              |
 * | ------------------------------ | ----------------------- | ------------------------------------------------- |
 * | checkout.completed             | checkout.completed      | 一次性购买带 orderId（ord_）；订阅结账不带订单      |
 * | subscription.active            | subscription.active     | 只同步状态，不发积分                              |
 * | subscription.paid              | subscription.renewed    | 每个账期付款（含首期）；orderId 用 last_transaction_id |
 * | subscription.scheduled_cancel  | subscription.canceled   | 已取消续费，到 current_period_end 前仍可用         |
 * | subscription.canceled          | subscription.canceled   |                                                   |
 * | subscription.update（active）  | subscription.active     | 恢复续费（撤销 scheduled_cancel）；其他状态忽略    |
 * | subscription.expired           | subscription.expired    |                                                   |
 * | subscription.past_due / unpaid | payment.failed          |                                                   |
 * | refund.created                 | refund.created          | 订阅付款按 transaction.id 对应订单，一次性按 order  |
 * | 其他（dispute、trialing、paused、credits.* 等） | 忽略（返回 null） |                          |
 *
 * 订单 ID 的约定：一次性购买用 Creem 的 order.id；订阅的每次付款用 transaction.id
 * （subscription.paid 只带 last_transaction_id，不带订单）。退款按同样的规则找到对应订单。
 * 金额以最小货币单位（分）计，和 Creem 一致。
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
/** Creem 的关联对象有时展开成对象，有时只给 ID。 */
const idOf = (value: unknown): string | undefined =>
  asString(value) ?? asString(asObject(value)?.id);

/** 结账时写入的 metadata：{ userId, planId }。订阅会复制结账的 metadata。 */
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

/** 把已校验的 Creem webhook 请求体转换成 BillingEvent；不关心的事件返回 null。 */
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
        // 订阅的付款由 subscription.paid 按 transaction 记录，这里只记一次性购买的订单。
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
      // 只关心恢复续费；其他变更（改数量等）v1 不处理。
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
        // subscription.paid 不带实付金额，用产品标价（不含税和折扣）作为近似值。
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

/** 用到的 SDK 方法，测试可以注入假的实现。 */
export type CreemClient = {
  checkouts: Pick<Creem["checkouts"], "create">;
  customers: Pick<Creem["customers"], "generateBillingLinks">;
  subscriptions: Pick<Creem["subscriptions"], "get" | "cancel">;
};

export type CreemProviderOptions = {
  apiKey: string;
  webhookSecret: string;
  mode: CreemMode;
  /** 测试注入；默认按 apiKey 和 mode 创建官方 SDK 客户端。 */
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
        // Creem 结账没有取消地址：用户关闭页面即可，input.cancelUrl 不使用。
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

    /** 立即取消。已取消、已预约在期末取消或不存在都视为成功（之后不会再扣款），便于重试。 */
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
