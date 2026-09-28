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

/** 客户门户的返回地址：门户是从站内账单页打开的，回来时回同一页。 */
const PORTAL_RETURN_PATH = "/billing";

/*
 * Stripe webhook → BillingEvent 映射（事件类型清单见 https://docs.stripe.com/api/events/types）：
 *
 * | Stripe event                              | BillingEvent           | 说明                                                     |
 * | ----------------------------------------- | ---------------------- | -------------------------------------------------------- |
 * | checkout.session.completed（mode=payment）| checkout.completed     | orderId 用 payment_intent，带 amount_total / currency     |
 * | checkout.session.completed（订阅）        | checkout.completed     | 不带 orderId：订阅的钱由 invoice.paid 记（一次付款只记一单）|
 * | invoice.paid                              | subscription.renewed   | 首期和续费都记；orderId 用 invoice.id，金额 amount_paid    |
 * | invoice.payment_failed                    | payment.failed         | orderId 也用 invoice.id：重试成功时合并回同一单            |
 * | customer.subscription.updated             | 按 status 分派，见 parseSubscriptionEvent                                           |
 * | customer.subscription.deleted             | subscription.expired   | 订阅已经结束（立即取消，或期末取消到期）                   |
 * | 其他（charge.refunded、charge.dispute.* 等）| 忽略（返回 null）                                                                 |
 *
 * 订单 ID 的约定和 Creem 一致：一次付款对应一个订单。订阅每一期都用 invoice.id 当订单号，
 * 订阅结账的分支不带 orderId，所以首期不会记成两单（重复记账会虚增 src/core/admin/metrics.ts 的营收）。
 * 订阅 metadata 是发票 finalize 时的快照，续费事件里仍能靠 parent.subscription_details.metadata
 * 找到 userId / planId；找不到时用发票行上的 Price ID 反查套餐。
 *
 * **v1 不处理退款**：Stripe 的退款对象上没有 invoice 字段，Charge / PaymentIntent 也不再暴露 invoice，
 * 想把退款对应回订单只能靠自定义 metadata，或者 Invoice Payment API
 * （invoice_payment.payment.payment_intent，只对 2019-03-15 之后 finalize 的发票可用）。
 * 那条路会把 Stripe 特有的结构漏进订单表和 src/core/admin/metrics.ts 的营收统计，
 * 所以退款事件一律忽略（Creem 的退款回收积分是它自己的路径，见 README 的「支付」一节）。
 *
 * 时间：Stripe 的 created / current_period_* 都是 Unix 秒，转 Date 要乘 1000。
 * 金额：以最小货币单位（分）计，和 events.ts 一致。
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
/** Stripe 的时间戳是 Unix 秒。 */
const asTimestamp = (value: unknown): Date | undefined => {
  const seconds = asNumber(value);
  if (seconds === undefined) return undefined;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date;
};
/** Stripe 的关联对象有时展开成对象，有时只给 ID。 */
const idOf = (value: unknown): string | undefined =>
  asString(value) ?? asString(asObject(value)?.id);

/** 结账时写入的 metadata：{ userId, planId }。订阅靠 subscription_data.metadata 复制过去。 */
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

/** 发票行上的 Price ID：当前 API 放在 pricing.price_details.price 上（顶层的 price 已移除）。 */
function lineItemPriceId(line: Loose | undefined) {
  const details = asObject(asObject(line?.pricing)?.price_details);
  return idOf(details?.price);
}

/**
 * 这一期账单覆盖的**服务周期**。当前 API 上 invoice.period_start / period_end 只是
 * 「能关联到这个发票项的时间范围」（见 https://docs.stripe.com/api/invoices/object），
 * 真正的服务周期在发票行的 period 上；拿不到行才退回发票的字段。
 */
function servicePeriod(line: Loose | undefined, invoice: Loose) {
  const period = asObject(line?.period);
  return {
    currentPeriodStart: asTimestamp(period?.start ?? invoice.period_start),
    currentPeriodEnd: asTimestamp(period?.end ?? invoice.period_end),
  };
}

/** metadata 里的 planId 优先；没有就按 Price ID 反查套餐（订阅项上是 price，发票行上是 pricing）。 */
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

/** 把已校验的 Stripe webhook 请求体转换成 BillingEvent；不关心的事件返回 null。 */
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
  // 订阅结账不带订单：钱在 invoice.paid 里记（mode 只有 payment / setup / subscription，
  // 我们创建结账时只会用前两者里的 payment 和 subscription）。
  const oneTime = asString(session.mode) !== "subscription";
  return {
    ...base,
    type: "checkout.completed",
    userId,
    customerId: idOf(session.customer),
    checkoutId,
    planId,
    // 一次性付款用 PaymentIntent 当订单号（没有就用结账会话的 ID）。
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
  // 只处理订阅开出来的发票：一次性发票（parent 为空或指向报价单）v1 不记订单。
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

  // 当前 API（2026-08-26.dahlia）把计费周期从 subscription 挪到了订阅项上：
  // subscription.current_period_* 已不存在，要读 items.data[0]。
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
    // deleted 是终态：订阅已经结束（立即取消，或 cancel_at_period_end 到期）。
    // 记成 expired 而不是 canceled —— canceled 表示「还能用到 currentPeriodEnd」，
    // 而立即取消时 Stripe 会先发一条 status=canceled 的 updated，那条已经记过 canceled 了。
    return { ...common, type: "subscription.expired" };
  }

  switch (asString(subscription.status)) {
    case "active":
    case "trialing":
      // 预约在期末取消：状态还是 active，但续费已经停了 → 按已取消处理，带上可用到的时间。
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
      // 扣款失败（Stripe 自己会重试）；订单由 invoice.payment_failed 记。
      return { ...common, type: "payment.failed" };
    case "canceled":
      return {
        ...common,
        type: "subscription.canceled",
        currentPeriodEnd: period.currentPeriodEnd,
      };
    default:
      // incomplete / incomplete_expired / paused / ended：v1 不处理。
      return null;
  }
}

/** 用到的 SDK 方法，测试可以注入假的实现。 */
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
  /** 测试注入；默认按 secretKey 创建官方 SDK 客户端（apiVersion 用 SDK 自带的默认值）。 */
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
        // 订阅用 subscription，一次性买断用 payment。
        mode: plan.subscription ? "subscription" : "payment",
        line_items: [{ price: plan.priceId, quantity: 1 }],
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        client_reference_id: input.userId,
        metadata,
        // 订阅要多带一份：Session 的 metadata **不会**复制到订阅上，
        // 只有 subscription_data.metadata 会。webhook 靠它找到用户和套餐。
        ...(plan.subscription && { subscription_data: { metadata } }),
        ...(input.customerEmail && { customer_email: input.customerEmail }),
      });
      // 不传 Idempotency-Key：重复下单由 checkout_sessions 表的复用和互斥处理（见 ../checkout.ts）。
      if (!session.url) {
        throw new Error("Stripe checkout session has no url");
      }
      return { checkoutId: session.id, url: session.url };
    },

    async getPortalUrl(customerId: string): Promise<string> {
      // Stripe 的客户门户必须给 return_url（Creem 的 generateBillingLinks 不需要）。
      // 这里拿不到 Request，用站点自己的绝对地址（和 canonical 同一个来源）回到账单页；
      // localePrefix 是 as-needed，默认语言不带前缀。
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${siteUrl}${PORTAL_RETURN_PATH}`,
      });
      return session.url;
    },

    /** 立即取消。已经不会再扣款的订阅视为成功（之后还会重试，不能因为终态就报错）。 */
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
      // body 必须是原始字符串：签名是对收到的字节做 HMAC，先 JSON.parse 再序列化会改字节。
      const body = await request.text();
      const signature = request.headers.get("stripe-signature") ?? "";
      try {
        // 同步版 constructEvent 走 node:crypto（NodeCryptoProvider）。我们的 webhook 路由
        // 跑在 Node.js runtime 上（src/app/api/webhooks/stripe/route.ts），stripe-node 官方
        // Next.js App Router 的例子也是同步版；constructEventAsync + createSubtleCryptoProvider()
        // 只给没有 node:crypto 的运行时（Cloudflare Workers / edge），同步版在那里会抛
        // CryptoProviderOnlySupportsAsyncError。容忍窗口用 SDK 默认的 300 秒。
        return stripe.webhooks.constructEvent(body, signature, webhookSecret);
      } catch (error) {
        if (error instanceof stripe.errors.StripeSignatureVerificationError) {
          throw new WebhookVerificationError(error.message);
        }
        // 签名对但 body 不是合法 JSON 时 constructEvent 抛的是 SyntaxError（不是签名错误）；
        // 这种请求结构不对，同样按未通过校验处理，不写库、不重试。
        if (error instanceof SyntaxError) {
          throw new WebhookVerificationError("Invalid webhook body");
        }
        throw error;
      }
    },

    parseEvent: parseStripeEvent,
  };
}

/** Stripe 的「对象不存在」错误（404）。 */
function isNotFound(error: unknown) {
  return (
    error instanceof Stripe.errors.StripeInvalidRequestError &&
    error.statusCode === 404
  );
}

/**
 * 已经不会再扣款、也就不能再取消的状态（见 https://docs.stripe.com/api/subscriptions/object 的 status）。
 * canceled：已经结束；incomplete_expired：首期没付上、发票已作废，是终态。
 * 其余状态（active / trialing / past_due / unpaid / paused / incomplete）都还能取消。
 */
function isTerminal(status: string) {
  return status === "canceled" || status === "incomplete_expired";
}

/** 结账要用的套餐信息：产品 ID 必填（免费套餐没有，也就不能结账）。 */
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
