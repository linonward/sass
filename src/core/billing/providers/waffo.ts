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
 * Waffo Pancake（https://pancake.waffo.ai，MoR）的 adapter，走官方 SDK `@waffo/pancake-ts`。
 *
 * 和 Creem / Lemon Squeezy 一样是 MoR、有产品目录：套餐的 `providerProductId` 填 Pancake 的
 * 产品 ID（`PROD_…`，test / prod 两套），金额和周期在 Pancake 后台的产品上定义。
 *
 * - 结账：`checkout.authenticated.create`。`buyerIdentity` = 我们的用户 ID（订单绑定到它，
 *   换邮箱也不会串单），`metadata` 带上 userId / planId，webhook 的 `orderMetadata` 原样带回。
 * - 验签：`verifyWebhook`（`X-Waffo-Signature`，RSA-SHA256，带时间戳防重放），**固定按 `WAFFO_MODE`
 *   的环境验**，并再核对事件的 `mode` —— 否则生产站点会收下测试环境（免费测试卡）的付款并发积分。
 * - 发生时间取信封的 `timestamp`；幂等键见下。
 * - 取消：`orders.cancelSubscription` —— 生效中的订阅变成 canceling，用到当期结束。
 *
 * 事件映射（Pancake → BillingEvent）：
 *
 * | Pancake                                                   | BillingEvent          |
 * | --------------------------------------------------------- | --------------------- |
 * | order.completed（一次性订单首付成功）                      | checkout.completed    |
 * | subscription.activated / renewed / recovered / uncanceled | subscription.active   |
 * | subscription.payment_succeeded（每一期扣款，含首期）       | subscription.renewed  |
 * | subscription.canceling（取消，用到当期结束）               | subscription.canceled |
 * | subscription.canceled（彻底终止）                          | subscription.expired  |
 * | subscription.past_due（续费扣款失败）                      | payment.failed        |
 * | refund.succeeded                                          | refund.created        |
 * | refund.failed、plan_change_* 等                            | 忽略                  |
 *
 * 订单 ID 的约定：模板的一张订单 = Pancake 的一笔付款（`paymentId`，`PAY_…`），一次性订单和订阅的
 * 每一期都一样；退款事件带着被退的那笔 `paymentId`，所以部分 / 全额退款都能对上具体哪一笔
 * （包括订阅的某一期）。订阅 ID 是订阅那张订单的 `orderId`（`ORD_…`）。
 *
 * 幂等键用「事件类型 + eventId」：官方文档和 SDK 对信封里 `id` 的含义说法不一（事件实体 ID /
 * 投递记录 UUID），官方文档建议按 eventType + eventId 去重，两种说法下都安全。
 *
 * 订阅 ID 同时记作客户 ID（Pancake 没有独立的客户对象）。套餐升降级（plan_change）不接：
 * 模板没有换套餐的流程。一次性付款被拒、结账放弃都没有 webhook（订单停在 pending），不需要映射。
 */

export const WAFFO_PROVIDER_ID = "waffo";

/** Pancake 的托管客户门户：魔法链接登录，跨商户。官方还没有「预登录」的门户链接接口。 */
export const WAFFO_PORTAL_URL =
  "https://pancake.waffo.ai/consumer/portal/login";

/** 不会再扣款的订阅单状态：取消中（用到期末）、已关闭 / 取消 / 过期。 */
const ENDED_SUBSCRIPTION = new Set([
  "canceling",
  "closed",
  "canceled",
  "expired",
]);

/**
 * 币种的 ISO 4217 最小单位位数（模板里的金额都按它存，例如 USD 2、JPY 0、KWD 3）。
 * 用明确的表而不是 `Intl`：Node 的 ICU 对个别币种（例如 IDR）给的是展示用的位数，不是 ISO 的。
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

/** Pancake 的展示金额（小数字符串，例如 "29.00"）→ 模板的最小货币单位。 */
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
  /** 测试注入：替换 SDK 的 fetch，不联网。 */
  fetch?: typeof fetch;
  /** 测试注入：webhook 验签用的公钥（生产用 SDK 内置的 Waffo 公钥）。 */
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
          // 被退的那笔付款（一次性订单或订阅的某一期），和记账时的订单 ID 同一套。
          orderId: data.paymentId,
          // eventId 是 Pancake 的退款 ID（REF_…）。
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
     * Pancake 的托管客户门户是魔法链接登录（买家输入邮箱收链接），官方还没有「预登录」链接的接口，
     * 所以这里返回门户登录页：买家用付款时的邮箱登录后能查订单、下发票、取消 / 恢复订阅。
     */
    async getPortalUrl(): Promise<string> {
      return WAFFO_PORTAL_URL;
    },

    /**
     * 删号时调用：生效中的订阅变成 canceling（不再续费，用到当期结束）。
     * 模板的约定是「已取消或不存在的订阅视为成功」（删号钩子要能安全重试）：接口报错时查一次
     * 这张订阅单，已经不会再扣款（或查不到）就当成功，否则把原错误抛出去。
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
      // 签名对了，但来自另一个环境（例如生产站点收到测试模式的付款）：当作无效，不处理。
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
