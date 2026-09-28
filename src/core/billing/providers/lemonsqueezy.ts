import { createHmac, timingSafeEqual } from "node:crypto";

import type { BillingEvent } from "../events";
import { getPlan, planByProductId } from "../plans";
import {
  WebhookVerificationError,
  type Checkout,
  type CreateCheckoutInput,
  type PaymentProvider,
} from "../provider";
import {
  createLemonSqueezyClient,
  LemonSqueezyApiError,
  LEMONSQUEEZY_PROVIDER_ID,
  type LemonSqueezyClient,
  type LemonSqueezyFetch,
} from "./lemonsqueezy/client";

export { LEMONSQUEEZY_PROVIDER_ID };

/*
 * Lemon Squeezy webhook → BillingEvent 映射（事件与字段见
 * https://docs.lemonsqueezy.com/help/webhooks/event-types 与各资源对象页）：
 *
 * | Lemon Squeezy 事件                    | BillingEvent            | 说明                                                        |
 * | ------------------------------------ | ----------------------- | ----------------------------------------------------------- |
 * | order_created（variant 映射到一次性） | checkout.completed      | orderId = 订单 ID，金额取 total                              |
 * | order_created（订阅套餐 / 映射不到）  | checkout.completed      | 不带 orderId：订阅首期由 invoice 事件记；映射不到按一次性记   |
 * | subscription_created/updated/resumed | subscription.active     | 按 attributes.status 分派（见下），renews_at → 账期结束       |
 * | subscription_cancelled               | subscription.canceled   | ends_at → 账期结束                                           |
 * | subscription_expired                 | subscription.expired    |                                                             |
 * | subscription_paused / unpaused       | 忽略 / subscription.active | 见 parseSubscriptionEvent 的注释                           |
 * | subscription_payment_success         | subscription.renewed    | orderId = invoice ID，金额取 total                           |
 * | subscription_payment_failed          | payment.failed          | 带 subscriptionId 和 invoice ID                              |
 * | subscription_payment_recovered       | 忽略                    | 官方说它总伴随一个 subscription_payment_success，两个都记会重复 |
 * | order_refunded / _payment_refunded   | refund.created          | 只在能证明是全额退款时映射，见 parseRefundEvent 的注释         |
 * | 其他（license key 等）                | 忽略                    |                                                             |
 *
 * 订单 ID 的约定：一次性购买与订阅的每次付款都用「产生这笔钱的资源 ID」（订单 ID / invoice ID）。
 * 金额以最小货币单位（分）计，和 events.ts 的约定一致。
 */

type Loose = Record<string, unknown>;

/** Lemon Squeezy webhook 的顶层：meta 描述事件，data 是事件发生时该资源的快照。 */
type LemonSqueezyWebhook = {
  meta: Loose;
  data: Loose;
};

const asObject = (value: unknown): Loose | undefined =>
  value && typeof value === "object" ? (value as Loose) : undefined;
const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;
const asDate = (value: unknown): Date | undefined => {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

/** ID：JSON:API 的 data.id 是字符串，attributes 里的 customer_id / variant_id 是数字。 */
const asId = (value: unknown): string | undefined =>
  (typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : undefined) ?? asString(value);

/**
 * 金额换算成分。
 *
 * 文档说这些字段是「整数分」，但官方示例里出现过小数（`order_created` 的 total 给的是
 * 1859.76，同一份示例的 total_formatted 又写着 $18.59 —— 两者对不上，见 PR 的说明）。
 * 小数按四舍五入兜底，整数原样返回，两种形状都不会把金额写错数量级。
 */
function toMinorUnits(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.round(parsed);
  }
  return undefined;
}

/** 结账时通过 `checkout_data.custom` 传的 { userId, planId }，事件里在 meta.custom_data 原样带回。 */
function customDataOf(meta: Loose) {
  const custom = asObject(meta.custom_data);
  return {
    userId: asString(custom?.userId),
    planId: asString(custom?.planId),
  };
}

/** metadata 里的 planId 优先；否则用服务商一侧的产品 ID 反查（variant 在前，product 兜底）。 */
function planIdOf(metaPlanId: string | undefined, ...productIds: unknown[]) {
  if (metaPlanId) return metaPlanId;
  for (const productId of productIds) {
    const id = asId(productId);
    const plan = id ? planByProductId(id) : undefined;
    if (plan) return plan.id;
  }
  return undefined;
}

/**
 * 把已校验的 Lemon Squeezy webhook 请求体转换成 BillingEvent；不关心的事件返回 null。
 *
 * 两个和官方文档不完全一致的地方：
 * 1. **没有事件 ID**。meta 里只有 event_name / webhook_id（那是 webhook 端点 ID，不是这次
 *    投递的 ID）/ custom_data。所以用「事件名 + 资源 ID + updated_at」合成一个：重复投递
 *    （Lemon Squeezy 重试、后台手动重发）得到同一个值，被 webhook_events 的
 *    (provider, event_id) 挡住；资源状态真的变了 updated_at 也会变，不会误挡。
 * 2. **invoice 事件不承诺带 custom_data**。官方只说它对 Order / Subscription / license key
 *    事件有效，所以 subscription_payment_* 的 planId 常常是 undefined —— handle-event 的
 *    applySubscription 只在订阅行还没有套餐时才用 planId，拿不到不影响续费。
 */
export function parseLemonSqueezyEvent(payload: unknown): BillingEvent | null {
  const root = asObject(payload) as LemonSqueezyWebhook | undefined;
  const meta = asObject(root?.meta);
  const data = asObject(root?.data);
  const attributes = asObject(data?.attributes);
  const eventName = asString(meta?.event_name);
  const resourceId = asId(data?.id);
  const occurredAt =
    asDate(attributes?.updated_at) ?? asDate(attributes?.created_at);
  // 缺时间戳说明这不是我们认识的 payload 形状：宁可丢掉，也不要给它编一个随机事件 ID
  // （那会让重推绕过幂等检查）。
  if (
    !meta ||
    !data ||
    !attributes ||
    !eventName ||
    !resourceId ||
    !occurredAt
  ) {
    return null;
  }

  const base = {
    provider: LEMONSQUEEZY_PROVIDER_ID,
    eventId: `${eventName}:${resourceId}:${occurredAt.toISOString()}`,
    occurredAt,
    raw: payload,
  };
  const { userId, planId: metaPlanId } = customDataOf(meta);
  const customerId = asId(attributes.customer_id);

  switch (eventName) {
    case "order_created":
      return parseOrderCreated({
        base,
        attributes,
        userId,
        metaPlanId,
        resourceId,
      });

    case "subscription_created":
    case "subscription_updated":
    case "subscription_resumed":
    case "subscription_cancelled":
    case "subscription_expired":
    case "subscription_paused":
    case "subscription_unpaused":
      return parseSubscriptionEvent({
        base,
        attributes,
        userId,
        metaPlanId,
        resourceId,
        customerId,
      });

    case "subscription_payment_success":
    case "subscription_payment_failed":
      return parseInvoiceEvent({
        base,
        eventName,
        attributes,
        userId,
        metaPlanId,
        resourceId,
        customerId,
      });

    case "order_refunded":
    case "subscription_payment_refunded":
      return parseRefundEvent({
        base,
        attributes,
        userId,
        resourceId,
        customerId,
      });

    default:
      // subscription_payment_recovered：官方说它总伴随一个 subscription_payment_success，
      // 两个都记会重复计收入，所以只认后者。
      return null;
  }
}

function parseOrderCreated({
  base,
  attributes,
  userId,
  metaPlanId,
  resourceId,
}: {
  base: EventBase;
  attributes: Loose;
  userId: string | undefined;
  metaPlanId: string | undefined;
  resourceId: string;
}): BillingEvent {
  const item = asObject(attributes.first_order_item);
  const planId = planIdOf(metaPlanId, item?.variant_id, item?.product_id);
  const plan = planId ? getPlan(planId) : undefined;
  // Lemon Squeezy 对订阅也会发 order_created（官方：subscription_created 总伴随一个
  // order_created），订阅首期的钱由 subscription_payment_success 记 —— 两边都记会让同一笔钱
  // 在收入口径里算两次（见 src/core/admin/metrics.ts），所以订阅套餐不记订单。
  // 反查不到套餐时按一次性记：宁可多记一笔收入，也不要漏账。
  const oneTime = plan?.type === "one_time" || !plan;
  return {
    ...base,
    type: "checkout.completed",
    userId,
    customerId: asId(attributes.customer_id),
    // 订单事件不带结账会话 ID，用订单 ID 占位（下游只用得到 orderId）。
    checkoutId: resourceId,
    planId,
    orderId: oneTime ? resourceId : undefined,
    amount: toMinorUnits(attributes.total),
    currency: asString(attributes.currency),
  };
}

/**
 * 订阅事件按 `attributes.status` 分派，而不是按事件名 —— 两者可能不一致（subscription_updated
 * 是官方的 catch-all，取消之后也可能推一条它是 cancelled 的更新）。按事件名一律映射成 active
 * 会把已取消的订阅"复活"。
 *
 * - active / on_trial → subscription.active（renews_at 作为账期结束）
 * - past_due / unpaid → payment.failed
 * - cancelled → subscription.canceled（ends_at 作为还能用到的时间：取消后仍有宽限期）
 * - expired → subscription.expired
 * - **paused / pause → 忽略**。订阅状态表里没有 paused（只有 active / past_due / canceled /
 *   expired），映射成 past_due 会触发一封"付款失败"邮件（emails.ts 的 payment.failed 分支），
 *   而暂停期间并没有付款失败这回事；映射成 canceled 又会错误地收回访问权。所以保持订阅行
 *   上一次的状态，等 subscription_unpaused（status 回到 active）或 subscription_expired 修正。
 * - 其他未知状态 → null（不猜）
 */
function parseSubscriptionEvent({
  base,
  attributes,
  userId,
  metaPlanId,
  resourceId,
  customerId,
}: {
  base: EventBase;
  attributes: Loose;
  userId: string | undefined;
  metaPlanId: string | undefined;
  resourceId: string;
  customerId: string | undefined;
}): BillingEvent | null {
  const common = {
    ...base,
    userId,
    customerId,
    subscriptionId: resourceId,
  };
  const period = {
    currentPeriodStart: asDate(attributes.created_at),
    currentPeriodEnd: asDate(attributes.renews_at),
  };
  const planId = planIdOf(
    metaPlanId,
    attributes.variant_id,
    attributes.product_id,
  );

  switch (asString(attributes.status)) {
    case "active":
    case "on_trial":
      return { ...common, ...period, type: "subscription.active", planId };
    case "past_due":
    case "unpaid":
      return { ...common, type: "payment.failed" };
    case "cancelled":
      return {
        ...common,
        type: "subscription.canceled",
        // 取消后到 ends_at 之前还能用（宽限期），renews_at 此时通常为 null。
        currentPeriodEnd: asDate(attributes.ends_at) ?? period.currentPeriodEnd,
      };
    case "expired":
      return { ...common, type: "subscription.expired" };
    default:
      return null;
  }
}

/**
 * subscription_payment_success / _failed：data 是 invoice 对象（type `subscription-invoices`）。
 * invoice 里没有 product_id / variant_id，planId 只能来自 meta.custom_data（官方没承诺 invoice
 * 事件带它）—— 拿不到就留 undefined，让 applySubscription 保留订阅行上已有的套餐。
 */
function parseInvoiceEvent({
  base,
  eventName,
  attributes,
  userId,
  metaPlanId,
  resourceId,
  customerId,
}: {
  base: EventBase;
  eventName: string;
  attributes: Loose;
  userId: string | undefined;
  metaPlanId: string | undefined;
  resourceId: string;
  customerId: string | undefined;
}): BillingEvent | null {
  const subscriptionId = asId(attributes.subscription_id);
  if (!subscriptionId) return null;
  const common = {
    ...base,
    userId,
    customerId,
    // orderId 用 invoice ID：订阅的每一笔付款（含首期）在 orders 里一行。
    orderId: resourceId,
    subscriptionId,
    planId: metaPlanId,
    amount: toMinorUnits(attributes.total),
    currency: asString(attributes.currency),
  };
  if (eventName === "subscription_payment_success") {
    return {
      ...common,
      type: "subscription.renewed",
      // invoice 的 created_at 就是这次账期的开始：积分按「订阅 + 账期」发放，
      // 键要稳定（见 grant-credits.ts 的 billingGrantSourceId）。
      currentPeriodStart: asDate(attributes.created_at),
    };
  }
  // 失败的 invoice 也记一行订单（status = failed）：收入口径只认 paid / refunded 那几个状态
  // （见 metrics.ts 的 collectedStatuses），不影响收入统计；之后这笔钱收上来时
  // subscription_payment_success 会把同一行改成 paid（mergeOrder 里付款成功优先）。
  return { ...common, type: "payment.failed" };
}

/**
 * 退款。**只在能证明是全额退款时才映射**：
 *
 * - `refunded_amount` 是订单/invoice 的**累计**已退金额，而下游的 `refund.created` 契约是
 *   **这一次退款的新增金额**（handle-event 的 mergeOrder 把 refund 累加）。把累计值当新增值
 *   发出去，同一张订单第二次部分退款就会重复计数、多回收积分。
 * - 两个对象的 `status` 都有 `refunded` 这一档，文档写的是「已付款但**此后被全额退款**」
 *   （invoice）/ 订单状态表里的 refunded；这是唯一能区分全额与部分退款的字段，所以要求它。
 *   再加上 `refunded_amount >= total` 兜底 —— 全额退款只发生一次，这样发出去的 `amount`
 *   既不重复也不会算错。
 * - **已知缺口：部分退款不映射**（status 还是 paid / 累计金额没到总额）。这类订单的积分不会
 *   被自动回收，需要人工处理。宁可不回收，也不要把钱算错 —— 不猜金额、不发半笔退款。
 */
function parseRefundEvent({
  base,
  attributes,
  userId,
  resourceId,
  customerId,
}: {
  base: EventBase;
  attributes: Loose;
  userId: string | undefined;
  resourceId: string;
  customerId: string | undefined;
}): BillingEvent | null {
  const amount = toMinorUnits(attributes.refunded_amount);
  const total = toMinorUnits(attributes.total);
  const currency = asString(attributes.currency);
  if (
    attributes.refunded !== true ||
    asString(attributes.status) !== "refunded" ||
    amount === undefined ||
    amount <= 0 ||
    total === undefined ||
    amount < total ||
    !currency
  ) {
    return null;
  }
  const refundedAt = asDate(attributes.refunded_at);
  return {
    ...base,
    type: "refund.created",
    userId,
    customerId,
    orderId: resourceId,
    // 全额退款一个订单只发生一次；refunded_at 稳定，重复投递时回收流水的
    // (source, sourceId) 也认得出是同一笔（见 reclaim-credits.ts）。
    refundId: (refundedAt ?? base.occurredAt).toISOString(),
    amount,
    currency,
  };
}

type EventBase = Pick<
  BillingEvent,
  "provider" | "eventId" | "occurredAt" | "raw"
>;

export type LemonSqueezyProviderOptions = {
  apiKey: string;
  webhookSecret: string;
  /** 店铺 ID（`LEMONSQUEEZY_STORE_ID`）：创建结账会话必填。 */
  storeId: string;
  /** 测试注入；默认按 apiKey 创建手写的 HTTP 客户端。 */
  client?: LemonSqueezyClient;
  /** 测试注入假 fetch（只有没传 client 时生效）。 */
  fetch?: LemonSqueezyFetch;
};

export function createLemonSqueezyProvider({
  apiKey,
  webhookSecret,
  storeId,
  client,
  fetch,
}: LemonSqueezyProviderOptions): PaymentProvider {
  const lemonSqueezy =
    client ?? createLemonSqueezyClient({ apiKey, ...(fetch && { fetch }) });

  return {
    id: LEMONSQUEEZY_PROVIDER_ID,

    async createCheckout(input: CreateCheckoutInput): Promise<Checkout> {
      const variantId = planVariantId(input.planId);
      const document = await lemonSqueezy.request("POST", "/v1/checkouts", {
        data: {
          type: "checkouts",
          attributes: {
            // 回跳地址在 product_options 里，**不在** checkout_data 里（常见错误）。
            product_options: { redirect_url: input.successUrl },
            checkout_data: {
              ...(input.customerEmail && { email: input.customerEmail }),
              // 原样回到 webhook 的 meta.custom_data；invoice 事件除外（见上面的注释）。
              custom: { userId: input.userId, planId: input.planId },
            },
          },
          relationships: {
            store: { data: { type: "stores", id: storeId } },
            variant: { data: { type: "variants", id: variantId } },
          },
        },
      });
      const data = asObject(asObject(document)?.data);
      const url = asString(asObject(data?.attributes)?.url);
      const checkoutId = asId(data?.id);
      if (!url || !checkoutId) {
        throw new Error("Lemon Squeezy checkout has no url");
      }
      // Lemon Squeezy 的结账页没有取消地址参数，用户关掉页面即可（input.cancelUrl 不使用）。
      return { checkoutId, url };
    },

    /**
     * 客户门户地址：`GET /v1/customers/:id` → `data.attributes.urls.customer_portal`。
     * 这是预签名链接（24 小时有效），客户**没有任何订阅时该字段是 null** —— 调用方 openPortal
     * 按「这个用户还没有客户记录」返回 no_customer，那是另一条边界（客户记录存在但订阅已全部
     * 结束），这里只能明确报错，让用户在服务商后台或重新下单解决。
     */
    async getPortalUrl(customerId: string): Promise<string> {
      const document = await lemonSqueezy.request(
        "GET",
        `/v1/customers/${encodeURIComponent(customerId)}`,
      );
      const attributes = asObject(
        asObject(asObject(document)?.data)?.attributes,
      );
      const urls = asObject(attributes?.urls);
      const portalUrl = asString(urls?.customer_portal);
      if (!portalUrl) {
        throw new Error(
          `Lemon Squeezy customer ${customerId} has no customer_portal url (no active subscription)`,
        );
      }
      return portalUrl;
    },

    /**
     * 取消订阅：`DELETE /v1/subscriptions/:id` 取消**后续扣款**，用户可以用到 `ends_at`。
     * 对「删号前停掉续费」这是正确语义（立即取消会把用户已付的当期也收走）。
     * 已经是 cancelled / expired、或订阅不存在（404）都视为成功，和 creem.ts 对齐，便于重试。
     */
    async cancelSubscription(subscriptionId: string): Promise<void> {
      try {
        const document = await lemonSqueezy.request(
          "GET",
          `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
        );
        const status = asString(
          asObject(asObject(asObject(document)?.data)?.attributes)?.status,
        );
        if (status === "cancelled" || status === "expired") return;
        await lemonSqueezy.request(
          "DELETE",
          `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
        );
      } catch (error) {
        if (error instanceof LemonSqueezyApiError && error.status === 404)
          return;
        throw error;
      }
    },

    /**
     * Lemon Squeezy 没有官方的验签 helper，按官方 Node 示例手写：`X-Signature` 头是
     * HMAC-SHA256（webhook 的 signing secret 做密钥）的 **hex** 摘要，必须对**原始 body**
     * 校验（`await request.text()`，不能先 JSON.parse 再序列化）。
     */
    async verifyWebhook(request: Request): Promise<unknown> {
      const body = await request.text();
      const signature = request.headers.get(WEBHOOK_SIGNATURE_HEADER);
      if (!signature) {
        throw new WebhookVerificationError("Missing X-Signature header");
      }
      const expected = Buffer.from(
        createHmac("sha256", webhookSecret).update(body).digest("hex"),
      );
      const actual = Buffer.from(signature);
      // timingSafeEqual 对长度不等的 buffer 会抛异常，先比长度（长度不同必然不匹配）。
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      ) {
        throw new WebhookVerificationError();
      }
      try {
        return JSON.parse(body);
      } catch {
        throw new WebhookVerificationError("Invalid webhook body");
      }
    },

    parseEvent: parseLemonSqueezyEvent,
  };
}

/** 签名字段名，见 Lemon Squeezy 的 webhook 文档。 */
const WEBHOOK_SIGNATURE_HEADER = "X-Signature";

function planVariantId(planId: string) {
  const plan = getPlan(planId);
  if (!plan?.providerProductId) {
    throw new Error(`Plan "${planId}" has no providerProductId`);
  }
  // Lemon Squeezy 结账用 variant（变体）ID，不是 product ID：site.config.ts 的
  // providerProductId 在 lemonsqueezy 下填的是 LEMONSQUEEZY_VARIANT_ID_*。
  return plan.providerProductId;
}
