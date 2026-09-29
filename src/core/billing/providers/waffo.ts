import { randomUUID } from "node:crypto";

import {
  Environment,
  Waffo,
  type ApiResponse,
  type HttpTransport,
  type PaymentNotificationResult,
  type RefundNotificationResult,
  type SubscriptionNotificationResult,
} from "@waffo/waffo-node";

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
 * Waffo（https://waffo.com/docs）的 adapter，走官方 SDK `@waffo/waffo-node`。
 *
 * 和其它三家的结构性差异（设计取舍都从这里来）：
 * - **没有产品目录**：金额每次下单时直接传，取套餐的 `price` 和 `billing.currency`（`inlinePricing`）。
 * - **所有请求 / 响应 / webhook 都是 RSA 签名**（SHA256WithRSA）：请求用我们的私钥签、响应和
 *   webhook 用 Waffo 的公钥验，webhook 的**回复**也要用我们的私钥签（`webhookResponse`），
 *   否则 Waffo 按失败重推。这些都交给 SDK。
 * - **webhook 没有事件 ID 和时间戳**：事件 ID 用「事件类型 + 业务 ID + 状态」合成（同一状态的
 *   重推得到同一个 ID），发生时间取通知里的业务时间（`orderCompletedAt` / `refundUpdatedAt` /
 *   `updatedAt`），都没有才用收到的时间。
 * - **取消订阅立即生效**：本 adapter 的 `cancelSubscription` 只在删号时调用，立即取消正是那里要的。
 * - 订阅没有现成的当期起止时间：续费事件用扣款完成时间 + 套餐周期推算。
 *
 * 事件映射（`eventType` / 结果里的状态 → BillingEvent）：
 *
 * | Waffo                                                        | BillingEvent            |
 * | ------------------------------------------------------------ | ----------------------- |
 * | PAYMENT_NOTIFICATION，PAY_SUCCESS，一次性订单                 | checkout.completed      |
 * | PAYMENT_NOTIFICATION，PAY_SUCCESS，订阅扣款（含首期）          | subscription.renewed    |
 * | PAYMENT_NOTIFICATION，ORDER_CLOSE，订阅续费（第 2 期起）        | payment.failed          |
 * | PAYMENT_NOTIFICATION，ORDER_CLOSE，一次性订单 / 订阅首期        | 忽略（见下）             |
 * | SUBSCRIPTION_STATUS_NOTIFICATION，ACTIVE                     | subscription.active     |
 * | SUBSCRIPTION_STATUS_NOTIFICATION，*_CANCELLED                | subscription.canceled   |
 * | SUBSCRIPTION_STATUS_NOTIFICATION，EXPIRED / CLOSE            | subscription.expired    |
 * | REFUND_NOTIFICATION，ORDER_PARTIALLY / FULLY_REFUNDED        | refund.created          |
 * | 其它（进行中的状态、PERIOD_CHANGED、CHANGE、拒付等）          | 忽略                    |
 *
 * 一次性订单的 ORDER_CLOSE 是「打开收银台没付、订单过期」，映射成 payment.failed 会给用户发
 * 「付款失败」邮件；订阅首期失败时订阅本身会变成 CLOSE（映射为 expired），不需要再报一次。
 * 续费重试用完时 Waffo 不会关订阅（仍是 ACTIVE），每次失败的扣款都会发 ORDER_CLOSE ——
 * 映射成 payment.failed，模板把订阅标成 past_due，失败邮件 24 小时内最多一封。
 *
 * 我们带过去、webhook 里带回来的 ID：
 * - `userInfo.userId` = 我们的用户 ID；
 * - 一次性：`merchantOrderId` = `<套餐 id>-<随机>`，`paymentRequestId`（幂等键）= 随机；
 * - 订阅：`subscriptionRequest`（幂等键，≤32 字符）= `<套餐 id>-<随机>`，扣款通知里只有它能带回套餐；
 *   `merchantSubscriptionId` = 套餐 id（Waffo 文档对这个字段的定义就是「订阅计划 ID」）。
 * - 订阅 ID 记作客户 ID：Waffo 没有客户对象，门户（`subscription/manage`）按订阅开。
 */

export const WAFFO_PROVIDER_ID = "waffo";

/** `subscriptionRequest` 最长 32 字符；套餐 id 占掉的越多，随机部分越短。至少留 16 位十六进制（64 位）。 */
export const WAFFO_MAX_PLAN_ID_LENGTH = 15;

/** Waffo 要求 0 位小数的币种（同币种下单时）；其余按 2 位。见 https://waffo.com/docs/en/developer-docs/core-concepts/currency */
const ZERO_DECIMAL = new Set([
  "JPY",
  "KRW",
  "VND",
  "CLP",
  "IDR",
  "COP",
  "KES",
  "TWD",
]);

const CANCELLED = new Set([
  "MERCHANT_CANCELLED",
  "USER_CANCELLED",
  "CHANNEL_CANCELLED",
  "PLATFORM_CANCELLED",
]);
const ENDED = new Set(["EXPIRED", "CLOSE"]);
const REFUNDED = new Set(["ORDER_PARTIALLY_REFUNDED", "ORDER_FULLY_REFUNDED"]);

/** 套餐价格（主币单位）→ Waffo 要的小数字符串。 */
export function waffoAmount(price: number, currency: string) {
  return price.toFixed(ZERO_DECIMAL.has(currency) ? 0 : 2);
}

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

/** Waffo 的小数字符串 → 模板的最小货币单位。 */
export function waffoMinorUnits(
  amount: string | undefined,
  currency: string,
): number | undefined {
  if (amount === undefined || amount === "") return undefined;
  const value = Number(amount);
  if (!Number.isFinite(value)) return undefined;
  return Math.round(value * 10 ** isoDigits(currency));
}

function randomHex(length: number) {
  return randomUUID().replace(/-/g, "").slice(0, length);
}

/** `<套餐 id>-<随机>` 里取回套餐 id。 */
function planFromRequest(value: unknown) {
  if (typeof value !== "string") return undefined;
  const cut = value.lastIndexOf("-");
  return cut > 0 ? value.slice(0, cut) : undefined;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown) {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function asDate(value: unknown) {
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** 订单 / 订阅的 `*Action` 是 JSON 字符串：取出收银台地址。 */
function redirectUrl(action: unknown) {
  if (typeof action !== "string") return undefined;
  try {
    const parsed = asObject(JSON.parse(action));
    return asString(parsed?.webUrl) ?? asString(parsed?.deeplinkUrl);
  } catch {
    return undefined;
  }
}

function addInterval(start: Date, plan: ReturnType<typeof getPlan>) {
  if (!plan || plan.interval === "once") return undefined;
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + (plan.interval === "year" ? 12 : 1));
  return end;
}

function unwrap<T>(response: ApiResponse<T>, what: string): T {
  if (response.isSuccess()) {
    const data = response.getData();
    if (data) return data;
  }
  throw new Error(
    `Waffo ${what} failed: ${response.getCode()} ${response.getMessage() ?? ""}`.trim(),
  );
}

export type WaffoProviderOptions = {
  apiKey: string;
  /** 我们的 RSA 私钥（Base64 PKCS8 DER 或 PEM）。 */
  privateKey: string;
  /** Waffo 的 RSA 公钥（Base64 X509 或 PEM）。 */
  publicKey: string;
  merchantId: string;
  mode: WaffoMode;
  /** 测试注入：替换 SDK 的 HTTP 层，不联网。 */
  httpTransport?: HttpTransport;
  /** 测试注入：固定时间。 */
  now?: () => Date;
};

export function createWaffoProvider({
  apiKey,
  privateKey,
  publicKey,
  merchantId,
  mode,
  httpTransport,
  now = () => new Date(),
}: WaffoProviderOptions): PaymentProvider {
  const waffo = new Waffo({
    apiKey,
    privateKey,
    waffoPublicKey: publicKey,
    merchantId,
    environment:
      mode === "production" ? Environment.PRODUCTION : Environment.SANDBOX,
    ...(httpTransport ? { httpTransport } : {}),
  });
  const webhook = waffo.webhook();
  const currency = siteConfig.billing.currency;

  function paymentEvent(
    result: PaymentNotificationResult,
    base: { eventId: string; raw: unknown },
  ): BillingEvent | null {
    const status = result.orderStatus;
    const orderId = asString(result.acquiringOrderId);
    const orderCurrency = asString(result.orderCurrency) ?? currency;
    const money = {
      amount: waffoMinorUnits(result.orderAmount, orderCurrency),
      currency: orderCurrency,
    };
    const common = {
      provider: WAFFO_PROVIDER_ID,
      eventId: base.eventId,
      raw: base.raw,
      userId: asString(asObject(result.userInfo)?.userId),
      occurredAt:
        asDate(result.orderCompletedAt) ??
        asDate(result.orderUpdatedAt) ??
        now(),
    };
    const subscription = asObject(result.subscriptionInfo);
    const subscriptionId = asString(subscription?.subscriptionId);

    if (!subscriptionId) {
      if (status !== "PAY_SUCCESS" || !orderId) return null;
      return {
        ...common,
        ...money,
        type: "checkout.completed",
        checkoutId: asString(result.paymentRequestId) ?? orderId,
        orderId,
        planId: planFromRequest(result.merchantOrderId),
      };
    }

    const planId = planFromRequest(subscription?.subscriptionRequest);
    const period = Number(subscription?.period ?? "1");
    if (status === "PAY_SUCCESS") {
      return {
        ...common,
        ...money,
        type: "subscription.renewed",
        customerId: subscriptionId,
        subscriptionId,
        orderId,
        planId,
        currentPeriodStart: common.occurredAt,
        currentPeriodEnd: addInterval(
          common.occurredAt,
          planId ? getPlan(planId) : undefined,
        ),
      };
    }
    if (status === "ORDER_CLOSE" && period > 1) {
      return {
        ...common,
        ...money,
        type: "payment.failed",
        customerId: subscriptionId,
        subscriptionId,
        orderId,
      };
    }
    return null;
  }

  function subscriptionEvent(
    result: SubscriptionNotificationResult,
    base: { eventId: string; raw: unknown },
  ): BillingEvent | null {
    const subscriptionId = asString(result.subscriptionId);
    if (!subscriptionId) return null;
    const status = result.subscriptionStatus ?? "";
    const productInfo = asObject(result.productInfo);
    const common = {
      provider: WAFFO_PROVIDER_ID,
      eventId: base.eventId,
      raw: base.raw,
      userId: asString(asObject(result.userInfo)?.userId),
      customerId: subscriptionId,
      subscriptionId,
      occurredAt: asDate(result.updatedAt) ?? now(),
    };
    if (status === "ACTIVE") {
      return {
        ...common,
        type: "subscription.active",
        planId:
          asString(result.merchantSubscriptionId) ??
          planFromRequest(result.subscriptionRequest),
      };
    }
    if (CANCELLED.has(status)) {
      // Waffo 取消立即生效，但用户已经付过当期：用到下一次扣款时间为止。
      return {
        ...common,
        type: "subscription.canceled",
        currentPeriodEnd: asDate(productInfo?.nextPaymentDateTime),
      };
    }
    if (ENDED.has(status)) return { ...common, type: "subscription.expired" };
    return null;
  }

  function refundEvent(
    result: RefundNotificationResult,
    base: { eventId: string; raw: unknown },
  ): BillingEvent | null {
    const orderId = asString(result.acquiringOrderId);
    const refundId =
      asString(result.acquiringRefundOrderId) ??
      asString(result.refundRequestId);
    if (!REFUNDED.has(result.refundStatus ?? "") || !orderId || !refundId) {
      return null;
    }
    // 退款通知不带币种；退款和原订单同币种，而我们只按站点币种下单。
    const amount = waffoMinorUnits(result.refundAmount, currency);
    if (amount === undefined) return null;
    const subscriptionId = asString(
      asObject(result.subscriptionInfo)?.subscriptionId,
    );
    return {
      provider: WAFFO_PROVIDER_ID,
      eventId: base.eventId,
      raw: base.raw,
      userId: asString(asObject(result.userInfo)?.userId),
      ...(subscriptionId ? { customerId: subscriptionId } : {}),
      occurredAt:
        asDate(result.refundCompletedAt) ??
        asDate(result.refundUpdatedAt) ??
        now(),
      type: "refund.created",
      orderId,
      refundId,
      amount,
      currency,
    };
  }

  return {
    id: WAFFO_PROVIDER_ID,
    inlinePricing: true,

    async createCheckout(input: CreateCheckoutInput): Promise<Checkout> {
      const plan = getPlan(input.planId);
      if (!plan || plan.price <= 0) {
        throw new Error(`Plan "${input.planId}" is not a paid plan`);
      }
      if (plan.id.length > WAFFO_MAX_PLAN_ID_LENGTH) {
        throw new Error(
          `Plan id "${plan.id}" is longer than ${WAFFO_MAX_PLAN_ID_LENGTH} characters, which Waffo's 32-character request id cannot carry`,
        );
      }
      const origin = new URL(input.successUrl).origin;
      const notifyUrl = `${origin}/api/webhooks/${WAFFO_PROVIDER_ID}`;
      const amount = waffoAmount(plan.price, currency);
      const requestedAt = now().toISOString();
      const description = `${siteConfig.name} ${plan.id}`.slice(0, 128);
      const userInfo = {
        userId: input.userId,
        // Waffo 要求邮箱；没有时按它文档给的兜底格式。
        userEmail: input.customerEmail ?? `${input.userId}@examples.com`,
        userTerminal: "WEB",
      };
      const goodsInfo = {
        goodsId: plan.id,
        goodsName: description,
        goodsUrl: `${origin}/pricing`,
      };
      const redirects = {
        successRedirectUrl: input.successUrl,
        failedRedirectUrl: input.cancelUrl,
        cancelRedirectUrl: input.cancelUrl,
      };

      if (plan.interval === "once") {
        const paymentRequestId = randomHex(32);
        const data = unwrap(
          await waffo.order().create({
            paymentRequestId,
            merchantOrderId: `${plan.id}-${randomHex(32)}`,
            orderCurrency: currency,
            orderAmount: amount,
            orderDescription: description,
            orderRequestedAt: requestedAt,
            notifyUrl,
            userInfo,
            goodsInfo,
            paymentInfo: { productName: "ONE_TIME_PAYMENT" },
            ...redirects,
          }),
          "order/create",
        );
        const url = redirectUrl(data.orderAction);
        if (!url)
          throw new Error("Waffo order/create returned no checkout URL");
        return { checkoutId: paymentRequestId, url };
      }

      const subscriptionRequest = `${plan.id}-${randomHex(31 - plan.id.length)}`;
      const data = unwrap(
        await waffo.subscription().create({
          subscriptionRequest,
          merchantSubscriptionId: plan.id,
          currency,
          amount,
          notifyUrl,
          productInfo: {
            description,
            // Waffo 没有 YEARLY：年付是每 12 个月一期。
            periodType: "MONTHLY",
            periodInterval: plan.interval === "year" ? "12" : "1",
          },
          userInfo,
          goodsInfo,
          paymentInfo: { productName: "SUBSCRIPTION" },
          requestedAt,
          // 用户在 Waffo 页面里点「管理订阅」时回到这里（要求是登录后的页面）。
          subscriptionManagementUrl: `${origin}/billing`,
          ...redirects,
        }),
        "subscription/create",
      );
      const url = redirectUrl(data.subscriptionAction);
      if (!url) {
        throw new Error("Waffo subscription/create returned no checkout URL");
      }
      return { checkoutId: subscriptionRequest, url };
    },

    /** 客户 ID 在这里就是订阅 ID（见文件头）；链接短时有效，所以每次点击时现取。 */
    async getPortalUrl(customerId: string): Promise<string> {
      const data = unwrap(
        await waffo.subscription().manage({ subscriptionId: customerId }),
        "subscription/manage",
      );
      if (!data.managementUrl) {
        throw new Error(
          `Waffo subscription ${customerId} has no management URL`,
        );
      }
      return data.managementUrl;
    },

    /**
     * 取消订阅（删号时调用）：Waffo 的取消立即生效，这正是删号要的。
     * 已经结束的订阅（取消 / 过期 / 关闭）视为成功，和其它 adapter 对齐，便于重试。
     */
    async cancelSubscription(subscriptionId: string): Promise<void> {
      // SDK 对多数业务错误返回错误码，对「结果未知」（E0001）直接抛异常：两种都先查一次状态。
      let failure: unknown;
      try {
        const response = await waffo
          .subscription()
          .cancel({ subscriptionId, requestedAt: now().toISOString() });
        if (response.isSuccess()) return;
        failure = new Error(
          `Waffo subscription/cancel failed: ${response.getCode()} ${response.getMessage() ?? ""}`.trim(),
        );
      } catch (error) {
        failure = error;
      }
      const inquiry = await waffo.subscription().inquiry({ subscriptionId });
      const status = inquiry.getData()?.subscriptionStatus ?? "";
      if (CANCELLED.has(status) || ENDED.has(status)) return;
      throw failure;
    },

    async verifyWebhook(request: Request): Promise<unknown> {
      const body = await request.text();
      const signature = request.headers.get("x-signature");
      if (!signature || !webhook.verifySignature(body, signature)) {
        throw new WebhookVerificationError();
      }
      try {
        return JSON.parse(body);
      } catch {
        throw new WebhookVerificationError("Invalid webhook body");
      }
    },

    parseEvent(payload: unknown): BillingEvent | null {
      const body = asObject(payload);
      const eventType = asString(body?.eventType);
      const result = asObject(body?.result);
      if (!eventType || !result) return null;
      const id = (businessId: unknown, status: unknown) =>
        `${eventType}:${String(businessId)}:${String(status)}`;

      switch (eventType) {
        case "PAYMENT_NOTIFICATION": {
          const r = result as PaymentNotificationResult;
          if (!r.acquiringOrderId) return null;
          return paymentEvent(r, {
            eventId: id(r.acquiringOrderId, r.orderStatus),
            raw: payload,
          });
        }
        case "SUBSCRIPTION_STATUS_NOTIFICATION": {
          const r = result as SubscriptionNotificationResult;
          return subscriptionEvent(r, {
            eventId: id(r.subscriptionId, r.subscriptionStatus),
            raw: payload,
          });
        }
        case "REFUND_NOTIFICATION": {
          const r = result as RefundNotificationResult;
          return refundEvent(r, {
            eventId: id(
              r.acquiringRefundOrderId ?? r.refundRequestId,
              r.refundStatus,
            ),
            raw: payload,
          });
        }
        default:
          return null;
      }
    },

    webhookResponse(ok: boolean): Response {
      const { body, signature } = ok
        ? webhook.buildSuccessResponse()
        : webhook.buildFailedResponse("processing_failed");
      return new Response(body, {
        status: ok ? 200 : 500,
        headers: {
          "content-type": "application/json",
          "x-signature": signature,
        },
      });
    },
  };
}
