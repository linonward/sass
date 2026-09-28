// @vitest-environment node
// stripe-node 的 webhooks / errors 需要 node:crypto（jsdom 环境下没有）。
import Stripe from "stripe";
import { describe, expect, test, vi } from "vitest";

import siteConfig from "../../../../site.config";
import { WebhookVerificationError } from "../provider";
import { stripeSample } from "./__fixtures__/stripe-webhooks";
import {
  createStripeProvider,
  parseStripeEvent,
  type StripeClient,
} from "./stripe";

const SECRET = "whsec_test_secret";
const PAYLOAD = JSON.stringify(
  stripeSample("checkout.session.completed.payment"),
);

/**
 * 用真实的 SDK 提供 webhooks / errors：签名校验和错误类型判定都是真跑（离线，不走网络），
 * 只有三个 API 调用换成假的。
 */
const sdk = new Stripe("sk_test_unit");

function fakeClient() {
  const client = {
    checkout: {
      sessions: {
        // 返回值放宽成 string | null，测试里能模拟服务商没给 URL 的情况。
        create: vi.fn(
          async (): Promise<{ id: string; url: string | null }> => ({
            id: "cs_test_1",
            url: "https://checkout.stripe.com/c/pay/cs_test_1",
          }),
        ),
      },
    },
    billingPortal: {
      sessions: {
        create: vi.fn(async () => ({
          url: "https://billing.stripe.com/p/session_1",
        })),
      },
    },
    subscriptions: {
      retrieve: vi.fn(async (): Promise<{ status: string }> => ({
        status: "active",
      })),
      cancel: vi.fn(async () => ({ status: "canceled" })),
    },
    webhooks: sdk.webhooks,
    errors: sdk.errors,
  };
  return client as unknown as StripeClient & typeof client;
}

const provider = (client = fakeClient()) =>
  createStripeProvider({
    secretKey: "sk_test_unit",
    webhookSecret: SECRET,
    client,
  });

/**
 * 用 SDK 自带的签名工具签一个请求（等价于 Stripe 发过来的 Stripe-Signature 头），
 * 不需要 secret 之外的任何东西，测试离线可跑。
 */
function signedRequest(
  body: string,
  signature = sdk.webhooks.generateTestHeaderString({
    payload: body,
    secret: SECRET,
  }),
) {
  return new Request("https://example.test/api/webhooks/stripe", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(signature !== "" && { "stripe-signature": signature }),
    },
    body,
  });
}

function apiError(status: number) {
  return new sdk.errors.StripeInvalidRequestError({
    message: "stripe error",
    type: "invalid_request_error",
    statusCode: status,
  });
}

describe("verifyWebhook", () => {
  test("签名正确时返回解析后的请求体", async () => {
    await expect(
      provider().verifyWebhook(signedRequest(PAYLOAD)),
    ).resolves.toEqual(JSON.parse(PAYLOAD));
  });

  test("签名错误时拒绝", async () => {
    await expect(
      provider().verifyWebhook(
        signedRequest(
          PAYLOAD,
          sdk.webhooks.generateTestHeaderString({
            payload: PAYLOAD,
            secret: "whsec_other",
          }),
        ),
      ),
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  test("缺少签名 header 时拒绝", async () => {
    await expect(
      provider().verifyWebhook(signedRequest(PAYLOAD, "")),
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  test("请求体被篡改时拒绝", async () => {
    const signature = sdk.webhooks.generateTestHeaderString({
      payload: PAYLOAD,
      secret: SECRET,
    });
    const tampered = PAYLOAD.replace(
      '"amount_total":19900',
      '"amount_total":1',
    );
    expect(tampered).not.toBe(PAYLOAD);
    await expect(
      provider().verifyWebhook(signedRequest(tampered, signature)),
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  test("签名过期时拒绝（容忍窗口 300 秒）", async () => {
    const old = Math.floor(Date.now() / 1000) - 3600;
    await expect(
      provider().verifyWebhook(
        signedRequest(
          PAYLOAD,
          sdk.webhooks.generateTestHeaderString({
            payload: PAYLOAD,
            secret: SECRET,
            timestamp: old,
          }),
        ),
      ),
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  test("签名对但请求体不是合法 JSON 时拒绝", async () => {
    await expect(
      provider().verifyWebhook(signedRequest("{not json")),
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });
});

describe("parseStripeEvent：官方示例 payload 的映射", () => {
  test("checkout.session.completed（一次性付款）：记订单，用 PaymentIntent 当订单号", () => {
    expect(
      parseStripeEvent(stripeSample("checkout.session.completed.payment")),
    ).toMatchObject({
      type: "checkout.completed",
      provider: "stripe",
      eventId: "evt_1MtwBwLkdIwHu7ixrBB4xk2L",
      occurredAt: new Date(1679600215 * 1000),
      userId: "user_1",
      planId: "lifetime",
      customerId: "cus_NeZwdNtLEOXuvB",
      checkoutId:
        "cs_test_a11YYufWQzNY63zpQ6QSNRQhkUpVph4WRmzW0zWJO2znZKdVujZ0N0S22u",
      orderId: "pi_3MtwBwLkdIwHu7ix28a3tqPa",
      subscriptionId: undefined,
      amount: 19900,
      currency: "usd",
    });
  });

  test("checkout.session.completed（订阅）：不记订单，钱的账由 invoice.paid 记", () => {
    expect(
      parseStripeEvent(stripeSample("checkout.session.completed.subscription")),
    ).toMatchObject({
      type: "checkout.completed",
      planId: "pro",
      subscriptionId: "sub_1MowQVLkdIwHu7ixeRlqHVzs",
      orderId: undefined,
      amount: undefined,
      currency: undefined,
    });
  });

  test("mode 缺失时按一次性付款处理（拿不到 PaymentIntent 就用结账会话 ID）", () => {
    const sample = stripeSample("checkout.session.completed.payment");
    delete sample.data.object.mode;
    delete sample.data.object.payment_intent;
    expect(parseStripeEvent(sample)).toMatchObject({
      orderId:
        "cs_test_a11YYufWQzNY63zpQ6QSNRQhkUpVph4WRmzW0zWJO2znZKdVujZ0N0S22u",
    });
  });

  test("invoice.paid → subscription.renewed，服务周期取发票行", () => {
    expect(parseStripeEvent(stripeSample("invoice.paid"))).toMatchObject({
      type: "subscription.renewed",
      provider: "stripe",
      eventId: "evt_1MtwBwLkdIwHu7ixuzkSPfKd",
      userId: "user_1",
      planId: "pro",
      customerId: "cus_Na6dX7aXxi11N4",
      subscriptionId: "sub_1MowQVLkdIwHu7ixeRlqHVzs",
      orderId: "in_1MowQWLkdIwHu7ixuzkSPfKd",
      currentPeriodStart: new Date(1679609767 * 1000),
      currentPeriodEnd: new Date(1682288167 * 1000),
      amount: 1900,
      currency: "usd",
    });
  });

  test("服务周期优先用发票行：invoice.period_* 只当兜底", () => {
    const sample = stripeSample("invoice.paid");
    const invoice = sample.data.object as {
      period_start: number;
      period_end: number;
      lines: { data: Array<{ period: { start: number; end: number } }> };
    };
    // 发票级的 period 是「能关联发票项的时间范围」，和服务周期可以不同。
    invoice.period_start = 1;
    invoice.period_end = 2;
    const firstLine = invoice.lines.data[0];
    if (!firstLine) throw new Error("fixture 至少要有一条发票行");
    firstLine.period = { start: 1679609767, end: 1682288167 };
    expect(parseStripeEvent(sample)).toMatchObject({
      currentPeriodStart: new Date(1679609767 * 1000),
      currentPeriodEnd: new Date(1682288167 * 1000),
    });
    // 没有发票行时才退回发票的 period_*。
    invoice.lines.data = [];
    expect(parseStripeEvent(sample)).toMatchObject({
      currentPeriodStart: new Date(1000),
      currentPeriodEnd: new Date(2000),
    });
  });

  test("没有 metadata 时按发票行的 Price ID 反查套餐", () => {
    const sample = stripeSample("invoice.paid");
    const parent = (
      sample.data.object as {
        parent: { subscription_details: { metadata: Record<string, unknown> } };
      }
    ).parent;
    parent.subscription_details.metadata = {};
    const pro = siteConfig.billing.plans.find((plan) => plan.id === "pro");
    const priceLine = (
      sample.data.object as {
        lines: {
          data: Array<{ pricing: { price_details: { price: string } } }>;
        };
      }
    ).lines.data[0];
    if (!priceLine) throw new Error("fixture 至少要有一条发票行");
    priceLine.pricing.price_details.price =
      pro?.providerProductId ?? "price_unknown";
    expect(parseStripeEvent(sample)).toMatchObject({ planId: "pro" });
    // metadata 也没有、Price ID 也不认识时只能为空。
    const unknown = stripeSample("invoice.paid");
    const unknownParent = (
      unknown.data.object as {
        parent: { subscription_details: { metadata: Record<string, unknown> } };
      }
    ).parent;
    unknownParent.subscription_details.metadata = {};
    expect(parseStripeEvent(unknown)).toMatchObject({ planId: undefined });
  });

  test("invoice.payment_failed → payment.failed，订单号也用发票 ID（重试成功会合并成一单）", () => {
    expect(
      parseStripeEvent(stripeSample("invoice.payment_failed")),
    ).toMatchObject({
      type: "payment.failed",
      subscriptionId: "sub_1MowQVLkdIwHu7ixeRlqHVzs",
      orderId: "in_1MowQWLkdIwHu7ixuzkSPfKd",
      amount: 1900,
      currency: "usd",
    });
  });

  test("parent 不是订阅（一次性发票）时忽略", () => {
    for (const parent of [
      null,
      { type: "quote_details", quote_details: { quote: "qt_1" } },
    ]) {
      const sample = stripeSample("invoice.paid");
      (sample.data.object as { parent: unknown }).parent = parent;
      expect(parseStripeEvent(sample)).toBeNull();
    }
  });

  test.each<[string, string]>([
    ["active", "subscription.active"],
    ["trialing", "subscription.active"],
    ["past_due", "payment.failed"],
    ["unpaid", "payment.failed"],
    ["canceled", "subscription.canceled"],
  ])("customer.subscription.updated（status=%s）→ %s", (status, type) => {
    const sample = stripeSample("customer.subscription.updated");
    (sample.data.object as { status: string }).status = status;
    const event = parseStripeEvent(sample);
    expect(event).toMatchObject({ type, provider: "stripe" });
    expect(event).toHaveProperty(
      "subscriptionId",
      "sub_1MowQVLkdIwHu7ixeRlqHVzs",
    );
  });

  test("active 时带上计费周期和套餐（周期在订阅项上，不在订阅上）", () => {
    expect(
      parseStripeEvent(stripeSample("customer.subscription.updated")),
    ).toMatchObject({
      type: "subscription.active",
      planId: "pro",
      userId: "user_1",
      currentPeriodStart: new Date(1679609767 * 1000),
      currentPeriodEnd: new Date(1682288167 * 1000),
    });
  });

  test("预约期末取消时按已取消处理，带上还能用到的时间", () => {
    const sample = stripeSample("customer.subscription.updated");
    (
      sample.data.object as { cancel_at_period_end: boolean }
    ).cancel_at_period_end = true;
    expect(parseStripeEvent(sample)).toMatchObject({
      type: "subscription.canceled",
      currentPeriodEnd: new Date(1682288167 * 1000),
    });
  });

  test("past_due 不带订单号：订单由 invoice.payment_failed 记", () => {
    const sample = stripeSample("customer.subscription.updated");
    (sample.data.object as { status: string }).status = "past_due";
    expect(parseStripeEvent(sample)).not.toHaveProperty("orderId");
  });

  test("customer.subscription.deleted → subscription.expired", () => {
    expect(
      parseStripeEvent(stripeSample("customer.subscription.deleted")),
    ).toMatchObject({
      type: "subscription.expired",
      subscriptionId: "sub_1MowQVLkdIwHu7ixeRlqHVzs",
      userId: "user_1",
    });
  });

  test.each(["incomplete", "incomplete_expired", "paused", "weird_status"])(
    "customer.subscription.updated 的 %s 状态不处理",
    (status) => {
      const sample = stripeSample("customer.subscription.updated");
      (sample.data.object as { status: string }).status = status;
      expect(parseStripeEvent(sample)).toBeNull();
    },
  );

  test("退款事件忽略（v1 不处理，见 stripe.ts 顶部说明）", () => {
    expect(parseStripeEvent(stripeSample("charge.refunded"))).toBeNull();
  });

  test("结构不对的请求体返回 null", () => {
    expect(parseStripeEvent(null)).toBeNull();
    expect(parseStripeEvent({ type: "invoice.paid" })).toBeNull();
    expect(parseStripeEvent({ id: "evt_1", type: "invoice.paid" })).toBeNull();
    expect(parseStripeEvent({ id: "evt_1", data: { object: {} } })).toBeNull();
    // 缺 id 的订阅事件也丢掉（(provider, eventId) 是幂等的键）。
    const noId = stripeSample("customer.subscription.deleted");
    delete noId.data.object.id;
    expect(parseStripeEvent(noId)).toBeNull();
  });

  test("raw 保留原始请求体", () => {
    const sample = stripeSample("invoice.paid");
    expect(parseStripeEvent(sample)?.raw).toEqual(sample);
  });
});

describe("createCheckout", () => {
  test("一次性买断：mode=payment，不带 subscription_data", async () => {
    const client = fakeClient();
    const checkout = await provider(client).createCheckout({
      userId: "user_1",
      planId: "lifetime",
      successUrl: "https://example.com/dashboard?checkout=success",
      cancelUrl: "https://example.com/#pricing",
      customerEmail: "a@example.com",
    });
    expect(checkout).toEqual({
      checkoutId: "cs_test_1",
      url: "https://checkout.stripe.com/c/pay/cs_test_1",
    });
    const lifetime = siteConfig.billing.plans.find(
      (plan) => plan.id === "lifetime",
    );
    expect(client.checkout.sessions.create).toHaveBeenCalledWith({
      mode: "payment",
      line_items: [{ price: lifetime?.providerProductId, quantity: 1 }],
      success_url: "https://example.com/dashboard?checkout=success",
      cancel_url: "https://example.com/#pricing",
      client_reference_id: "user_1",
      metadata: { userId: "user_1", planId: "lifetime" },
      customer_email: "a@example.com",
    });
  });

  test("订阅：mode=subscription，metadata 同时写到订阅上", async () => {
    const client = fakeClient();
    await provider(client).createCheckout({
      userId: "user_1",
      planId: "pro",
      successUrl: "https://example.com/dashboard?checkout=success",
      cancelUrl: "https://example.com/#pricing",
    });
    const pro = siteConfig.billing.plans.find((plan) => plan.id === "pro");
    expect(client.checkout.sessions.create).toHaveBeenCalledWith({
      mode: "subscription",
      line_items: [{ price: pro?.providerProductId, quantity: 1 }],
      success_url: "https://example.com/dashboard?checkout=success",
      cancel_url: "https://example.com/#pricing",
      client_reference_id: "user_1",
      metadata: { userId: "user_1", planId: "pro" },
      // Session 的 metadata 不会复制到订阅上，只有 subscription_data.metadata 会。
      subscription_data: { metadata: { userId: "user_1", planId: "pro" } },
    });
  });

  test("套餐没有产品 ID 时抛错", async () => {
    await expect(
      provider().createCheckout({
        userId: "user_1",
        planId: "free",
        successUrl: "https://x.test",
        cancelUrl: "https://x.test",
      }),
    ).rejects.toThrow(/providerProductId/);
  });

  test("服务商没给 URL 时抛错", async () => {
    const client = fakeClient();
    client.checkout.sessions.create.mockResolvedValueOnce({
      id: "cs_test_2",
      url: null,
    });
    await expect(
      provider(client).createCheckout({
        userId: "user_1",
        planId: "pro",
        successUrl: "https://x.test",
        cancelUrl: "https://x.test",
      }),
    ).rejects.toThrow(/no url/);
  });
});

describe("cancelSubscription", () => {
  test("有效订阅：立即取消", async () => {
    const client = fakeClient();
    await provider(client).cancelSubscription("sub_1");
    expect(client.subscriptions.cancel).toHaveBeenCalledWith("sub_1");
  });

  test.each(["canceled", "incomplete_expired"])(
    "已经是 %s：不再取消，视为成功",
    async (status) => {
      const client = fakeClient();
      client.subscriptions.retrieve.mockResolvedValueOnce({ status });
      await provider(client).cancelSubscription("sub_1");
      expect(client.subscriptions.cancel).not.toHaveBeenCalled();
    },
  );

  test.each(["active", "trialing", "past_due", "unpaid", "paused"])(
    "%s 还能取消，照常调 cancel",
    async (status) => {
      const client = fakeClient();
      client.subscriptions.retrieve.mockResolvedValueOnce({ status });
      await provider(client).cancelSubscription("sub_1");
      expect(client.subscriptions.cancel).toHaveBeenCalledWith("sub_1");
    },
  );

  test("订阅不存在（404）：视为成功", async () => {
    const client = fakeClient();
    client.subscriptions.retrieve.mockRejectedValueOnce(apiError(404));
    await expect(
      provider(client).cancelSubscription("sub_1"),
    ).resolves.toBeUndefined();
  });

  test("其他错误：向上抛出", async () => {
    const client = fakeClient();
    client.subscriptions.cancel.mockRejectedValueOnce(apiError(500));
    await expect(
      provider(client).cancelSubscription("sub_1"),
    ).rejects.toThrow();
  });

  test("非 Stripe 的错误向上抛出", async () => {
    const client = fakeClient();
    client.subscriptions.retrieve.mockRejectedValueOnce(new Error("boom"));
    await expect(provider(client).cancelSubscription("sub_1")).rejects.toThrow(
      "boom",
    );
  });
});

test("getPortalUrl 带上回跳地址", async () => {
  const client = fakeClient();
  await expect(provider(client).getPortalUrl("cus_1")).resolves.toBe(
    "https://billing.stripe.com/p/session_1",
  );
  expect(client.billingPortal.sessions.create).toHaveBeenCalledWith({
    customer: "cus_1",
    // 回跳地址来自站点自己的域名（site.config.ts，可用 SITE_DOMAIN 覆盖），
    // 所以断言也跟着同一个来源，不能写死域名（CI 里是 ci.example.test）。
    return_url: `https://${siteConfig.domain}/billing`,
  });
});

test("provider.id 是注册表用的 stripe", () => {
  expect(provider().id).toBe("stripe");
});
