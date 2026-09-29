import {
  RsaUtils,
  type HttpRequest,
  type HttpResponse,
  type HttpTransport,
} from "@waffo/waffo-node";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { WebhookVerificationError } from "../provider";
import { processWebhook } from "../webhook";
import {
  createWaffoProvider,
  WAFFO_MAX_PLAN_ID_LENGTH,
  waffoAmount,
  waffoMinorUnits,
} from "./waffo";

// 真实的官方 SDK + 离线生成的两对 RSA 密钥（我方 / 模拟的 Waffo），HTTP 层换成假的：
// 请求签名、响应验签、webhook 验签、回复签名都是真跑的，不联网、不需要任何真实密钥。
//
// webhook 的 fixture 按 Waffo 文档的约定构造：`{ eventType, result }`，`result` 与对应查询接口
// （order / subscription / refund inquiry）的 `data` 同构，字段名取自官方 OpenAPI 规范；
// 文档没有给完整的示例 body，所以这里没有逐字节照抄的 payload。时间是 ISO 8601，金额是小数字符串。

// 站点配置里的套餐：pro（月付 19）、lifetime（一次性 199）。再加一个年付的，覆盖 MONTHLY × 12。
vi.mock("../plans", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../plans")>();
  const yearly = {
    id: "annual",
    price: 190,
    interval: "year",
    type: "subscription",
    credits: 24000,
    features: [],
  };
  return {
    ...actual,
    getPlan: (id: string) =>
      id === "annual" ? (yearly as never) : actual.getPlan(id),
  };
});

const merchant = RsaUtils.generateKeyPair();
const waffoKeys = RsaUtils.generateKeyPair();
const NOW = new Date("2026-09-29T08:00:00.000Z");

type Reply = {
  code?: string;
  msg?: string;
  data?: unknown;
  badSignature?: boolean;
};

function fakeTransport() {
  const requests: {
    path: string;
    body: Record<string, unknown>;
    request: HttpRequest;
  }[] = [];
  const replies = new Map<string, Reply[]>();
  const transport: HttpTransport = {
    async send(request: HttpRequest): Promise<HttpResponse> {
      const path = new URL(request.url).pathname;
      requests.push({ path, body: JSON.parse(request.body ?? "{}"), request });
      const reply = replies.get(path)?.shift() ?? { code: "0", data: {} };
      const body = JSON.stringify({
        code: reply.code ?? "0",
        msg: reply.msg ?? "success",
        data: reply.data,
      });
      return {
        statusCode: 200,
        headers: {
          "x-signature": RsaUtils.sign(
            reply.badSignature ? `${body} ` : body,
            waffoKeys.privateKey,
          ),
        },
        body,
      };
    },
  };
  return {
    transport,
    requests,
    reply(path: string, reply: Reply) {
      replies.set(path, [...(replies.get(path) ?? []), reply]);
    },
  };
}

function setup() {
  const http = fakeTransport();
  const provider = createWaffoProvider({
    apiKey: "api-key",
    privateKey: merchant.privateKey,
    publicKey: waffoKeys.publicKey,
    merchantId: "M001",
    mode: "sandbox",
    httpTransport: http.transport,
    now: () => NOW,
  });
  return { provider, http };
}

/** 模拟 Waffo 推来的 webhook：body 用 Waffo 的私钥签名。 */
function webhookRequest(payload: unknown, { sign = true } = {}) {
  const body = JSON.stringify(payload);
  return new Request("https://acme.test/api/webhooks/waffo", {
    method: "POST",
    headers: sign
      ? { "x-signature": RsaUtils.sign(body, waffoKeys.privateKey) }
      : {},
    body,
  });
}

const checkout = {
  userId: "user_1",
  customerEmail: "ada@example.com",
  successUrl: "https://acme.test/en/billing/success",
  cancelUrl: "https://acme.test/en#pricing",
};

describe("Waffo adapter", () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
  });

  test("金额直接传：声明 inlinePricing；按币种精度格式化、按 ISO 最小单位解析", () => {
    expect(s.provider.inlinePricing).toBe(true);
    expect(waffoAmount(19, "USD")).toBe("19.00");
    expect(waffoAmount(9.99, "EUR")).toBe("9.99");
    expect(waffoAmount(1000, "JPY")).toBe("1000");
    expect(waffoAmount(150000, "IDR")).toBe("150000");
    expect(waffoMinorUnits("19.00", "USD")).toBe(1900);
    expect(waffoMinorUnits("9.99", "EUR")).toBe(999);
    expect(waffoMinorUnits("1000", "JPY")).toBe(1000);
    // IDR 按 ISO 有 2 位小数：Waffo 同币种下单给整数，存成最小单位要 × 100。
    expect(waffoMinorUnits("150000", "IDR")).toBe(15000000);
    expect(waffoMinorUnits(undefined, "USD")).toBeUndefined();
    expect(waffoMinorUnits("abc", "USD")).toBeUndefined();
  });

  describe("createCheckout", () => {
    test("一次性购买：order/create，请求带签名，金额取套餐价格，跳转收银台", async () => {
      s.http.reply("/api/v1/order/create", {
        data: {
          acquiringOrderId: "ACQ1",
          orderStatus: "PAY_IN_PROGRESS",
          orderAction: JSON.stringify({
            actionType: "WEB",
            webUrl: "https://checkout-sandbox.waffo.com/pay/abc",
          }),
        },
      });
      const result = await s.provider.createCheckout({
        ...checkout,
        planId: "lifetime",
      });

      const [call] = s.http.requests;
      expect(call!.path).toBe("/api/v1/order/create");
      expect(call!.request.url).toMatch(/^https:\/\/api-sandbox\.waffo\.com\//);
      // 请求体用我方私钥签名，Waffo 用我们上传的公钥验。
      expect(
        RsaUtils.verify(
          call!.request.body!,
          call!.request.headers["X-SIGNATURE"] ??
            call!.request.headers["x-signature"]!,
          merchant.publicKey,
        ),
      ).toBe(true);
      expect(call!.body).toMatchObject({
        orderCurrency: "USD",
        orderAmount: "199.00",
        notifyUrl: "https://acme.test/api/webhooks/waffo",
        userInfo: {
          userId: "user_1",
          userEmail: "ada@example.com",
          userTerminal: "WEB",
        },
        goodsInfo: {
          goodsId: "lifetime",
          goodsUrl: "https://acme.test/pricing",
        },
        paymentInfo: { productName: "ONE_TIME_PAYMENT" },
        successRedirectUrl: checkout.successUrl,
        cancelRedirectUrl: checkout.cancelUrl,
        orderRequestedAt: NOW.toISOString(),
        merchantInfo: { merchantId: "M001" },
      });
      expect(call!.body.paymentRequestId).toMatch(/^[0-9a-f]{32}$/);
      expect(call!.body.merchantOrderId).toMatch(/^lifetime-[0-9a-f]{32}$/);
      expect(result).toEqual({
        checkoutId: call!.body.paymentRequestId,
        url: "https://checkout-sandbox.waffo.com/pay/abc",
      });
    });

    test("月付订阅：subscription/create，MONTHLY × 1；请求号带回套餐且不超过 32 字符", async () => {
      s.http.reply("/api/v1/subscription/create", {
        data: {
          subscriptionId: "SUB1",
          subscriptionStatus: "AUTHORIZATION_REQUIRED",
          subscriptionAction: JSON.stringify({
            webUrl: "https://checkout-sandbox.waffo.com/sub/1",
          }),
        },
      });
      const result = await s.provider.createCheckout({
        ...checkout,
        planId: "pro",
      });
      const [call] = s.http.requests;
      expect(call!.path).toBe("/api/v1/subscription/create");
      expect(call!.body).toMatchObject({
        merchantSubscriptionId: "pro",
        currency: "USD",
        amount: "19.00",
        productInfo: { periodType: "MONTHLY", periodInterval: "1" },
        paymentInfo: { productName: "SUBSCRIPTION" },
        subscriptionManagementUrl: "https://acme.test/billing",
        notifyUrl: "https://acme.test/api/webhooks/waffo",
      });
      const request = String(call!.body.subscriptionRequest);
      expect(request).toMatch(/^pro-[0-9a-f]+$/);
      expect(request).toHaveLength(32);
      expect(result).toEqual({
        checkoutId: request,
        url: "https://checkout-sandbox.waffo.com/sub/1",
      });
    });

    test("年付：Waffo 没有 YEARLY，按 MONTHLY × 12", async () => {
      s.http.reply("/api/v1/subscription/create", {
        data: {
          subscriptionAction: JSON.stringify({ webUrl: "https://x.test/s" }),
        },
      });
      await s.provider.createCheckout({ ...checkout, planId: "annual" });
      expect(s.http.requests[0]!.body).toMatchObject({
        amount: "190.00",
        productInfo: { periodType: "MONTHLY", periodInterval: "12" },
      });
    });

    test("没有邮箱时用 Waffo 文档给的兜底格式", async () => {
      s.http.reply("/api/v1/order/create", {
        data: { orderAction: JSON.stringify({ webUrl: "https://x.test/p" }) },
      });
      await s.provider.createCheckout({
        ...checkout,
        customerEmail: undefined,
        planId: "lifetime",
      });
      expect(s.http.requests[0]!.body).toMatchObject({
        userInfo: { userEmail: "user_1@examples.com" },
      });
    });

    test("失败：业务错误码、响应签名不对、没有收银台地址、免费 / 不存在的套餐都抛错", async () => {
      s.http.reply("/api/v1/order/create", {
        code: "A0003",
        msg: "amount precision",
      });
      await expect(
        s.provider.createCheckout({ ...checkout, planId: "lifetime" }),
      ).rejects.toThrow(/A0003/);

      s.http.reply("/api/v1/order/create", {
        data: { orderAction: JSON.stringify({ webUrl: "https://x.test" }) },
        badSignature: true,
      });
      await expect(
        s.provider.createCheckout({ ...checkout, planId: "lifetime" }),
      ).rejects.toThrow();

      s.http.reply("/api/v1/order/create", {
        data: { orderStatus: "PAY_IN_PROGRESS" },
      });
      await expect(
        s.provider.createCheckout({ ...checkout, planId: "lifetime" }),
      ).rejects.toThrow(/no checkout URL/);

      await expect(
        s.provider.createCheckout({ ...checkout, planId: "free" }),
      ).rejects.toThrow(/not a paid plan/);
      await expect(
        s.provider.createCheckout({ ...checkout, planId: "nope" }),
      ).rejects.toThrow(/not a paid plan/);
      expect(WAFFO_MAX_PLAN_ID_LENGTH).toBe(15);
    });
  });

  describe("webhook", () => {
    test("验签：Waffo 私钥签的 body 通过；没签名、签名不对都抛 WebhookVerificationError", async () => {
      const payload = {
        eventType: "PAYMENT_NOTIFICATION",
        result: { acquiringOrderId: "A" },
      };
      await expect(
        s.provider.verifyWebhook(webhookRequest(payload)),
      ).resolves.toEqual(payload);
      await expect(
        s.provider.verifyWebhook(webhookRequest(payload, { sign: false })),
      ).rejects.toBeInstanceOf(WebhookVerificationError);

      const body = JSON.stringify(payload);
      const forged = new Request("https://acme.test/api/webhooks/waffo", {
        method: "POST",
        // 用错的私钥（我方的）签：Waffo 公钥验不过。
        headers: { "x-signature": RsaUtils.sign(body, merchant.privateKey) },
        body,
      });
      await expect(s.provider.verifyWebhook(forged)).rejects.toBeInstanceOf(
        WebhookVerificationError,
      );
    });

    test("回复：成功是带签名的 {message: success}，失败是 500 + {message: failed}", async () => {
      const ok = s.provider.webhookResponse!(true);
      const okBody = await ok.text();
      expect(ok.status).toBe(200);
      expect(JSON.parse(okBody)).toEqual({ message: "success" });
      expect(
        RsaUtils.verify(
          okBody,
          ok.headers.get("x-signature")!,
          merchant.publicKey,
        ),
      ).toBe(true);

      const failed = s.provider.webhookResponse!(false);
      const failedBody = await failed.text();
      expect(failed.status).toBe(500);
      expect(JSON.parse(failedBody)).toEqual({ message: "failed" });
      expect(
        RsaUtils.verify(
          failedBody,
          failed.headers.get("x-signature")!,
          merchant.publicKey,
        ),
      ).toBe(true);
    });

    test("processWebhook：未签名 401；不关心的事件也用签名的 success 回复（否则 Waffo 会重推）", async () => {
      const unsigned = await processWebhook(
        s.provider,
        webhookRequest(
          { eventType: "PAYMENT_NOTIFICATION", result: {} },
          { sign: false },
        ),
      );
      expect(unsigned.status).toBe(401);

      const ignored = await processWebhook(
        s.provider,
        webhookRequest({
          eventType: "CHARGEBACK_NOTIFICATION",
          result: { id: "x" },
        }),
      );
      const body = await ignored.text();
      expect(ignored.status).toBe(200);
      expect(JSON.parse(body)).toEqual({ message: "success" });
      expect(
        RsaUtils.verify(
          body,
          ignored.headers.get("x-signature")!,
          merchant.publicKey,
        ),
      ).toBe(true);
    });
  });

  describe("parseEvent", () => {
    const payment = (result: Record<string, unknown>) => ({
      eventType: "PAYMENT_NOTIFICATION",
      result: {
        paymentRequestId: "req1",
        merchantOrderId: "lifetime-0123456789abcdef0123456789abcdef",
        acquiringOrderId: "ACQ1",
        orderStatus: "PAY_SUCCESS",
        orderCurrency: "USD",
        orderAmount: "199.00",
        userInfo: { userId: "user_1", userEmail: "ada@example.com" },
        orderUpdatedAt: "2026-09-29T08:01:00.000Z",
        orderCompletedAt: "2026-09-29T08:01:00.000Z",
        ...result,
      },
    });
    const subscriptionPayment = (period: string, orderStatus = "PAY_SUCCESS") =>
      payment({
        merchantOrderId: undefined,
        acquiringOrderId: `ACQ-${period}`,
        orderStatus,
        orderAmount: "19.00",
        subscriptionInfo: {
          subscriptionRequest: "pro-0123456789abcdef0123456789ab",
          subscriptionId: "SUB1",
          period,
        },
      });
    const status = (
      subscriptionStatus: string,
      extra: Record<string, unknown> = {},
    ) => ({
      eventType: "SUBSCRIPTION_STATUS_NOTIFICATION",
      result: {
        subscriptionRequest: "pro-0123456789abcdef0123456789ab",
        merchantSubscriptionId: "pro",
        subscriptionId: "SUB1",
        subscriptionStatus,
        userInfo: { userId: "user_1" },
        updatedAt: "2026-09-30T00:00:00.000Z",
        ...extra,
      },
    });
    const refund = (refundStatus: string, refundAmount = "49.75") => ({
      eventType: "REFUND_NOTIFICATION",
      result: {
        refundRequestId: "rr1",
        acquiringRefundOrderId: "REF1",
        acquiringOrderId: "ACQ1",
        origPaymentRequestId: "req1",
        refundAmount,
        refundStatus,
        remainingRefundAmount: "149.25",
        userInfo: { userId: "user_1" },
        refundUpdatedAt: "2026-10-01T00:00:00.000Z",
      },
    });

    test("一次性付款成功 → checkout.completed，带回套餐、用户、金额（最小单位）", () => {
      expect(s.provider.parseEvent(payment({}))).toEqual({
        provider: "waffo",
        type: "checkout.completed",
        eventId: "PAYMENT_NOTIFICATION:ACQ1:PAY_SUCCESS",
        occurredAt: new Date("2026-09-29T08:01:00.000Z"),
        userId: "user_1",
        checkoutId: "req1",
        orderId: "ACQ1",
        planId: "lifetime",
        amount: 19900,
        currency: "USD",
        raw: expect.anything(),
      });
    });

    test("同一状态的重推得到同一个事件 ID；状态不同 ID 不同", () => {
      const a = s.provider.parseEvent(payment({}));
      const b = s.provider.parseEvent(payment({}));
      expect(a!.eventId).toBe(b!.eventId);
      const refundA = s.provider.parseEvent(refund("ORDER_PARTIALLY_REFUNDED"));
      const refundB = s.provider.parseEvent(refund("ORDER_FULLY_REFUNDED"));
      expect(refundA!.eventId).not.toBe(refundB!.eventId);
    });

    test("订阅扣款成功（含首期）→ subscription.renewed，当期按扣款时间 + 一个月推算", () => {
      expect(s.provider.parseEvent(subscriptionPayment("1"))).toMatchObject({
        type: "subscription.renewed",
        subscriptionId: "SUB1",
        customerId: "SUB1",
        orderId: "ACQ-1",
        planId: "pro",
        amount: 1900,
        currency: "USD",
        currentPeriodStart: new Date("2026-09-29T08:01:00.000Z"),
        currentPeriodEnd: new Date("2026-10-29T08:01:00.000Z"),
      });
    });

    test("续费扣款失败（第 2 期起）→ payment.failed；一次性订单和首期的失败忽略", () => {
      expect(
        s.provider.parseEvent(subscriptionPayment("2", "ORDER_CLOSE")),
      ).toMatchObject({
        type: "payment.failed",
        subscriptionId: "SUB1",
        orderId: "ACQ-2",
      });
      expect(
        s.provider.parseEvent(subscriptionPayment("1", "ORDER_CLOSE")),
      ).toBeNull();
      expect(
        s.provider.parseEvent(payment({ orderStatus: "ORDER_CLOSE" })),
      ).toBeNull();
      expect(
        s.provider.parseEvent(payment({ orderStatus: "PAY_IN_PROGRESS" })),
      ).toBeNull();
    });

    test("订阅状态：ACTIVE → active（套餐取 merchantSubscriptionId）、取消 → canceled（用到下次扣款）、过期 / 关闭 → expired", () => {
      expect(s.provider.parseEvent(status("ACTIVE"))).toMatchObject({
        type: "subscription.active",
        subscriptionId: "SUB1",
        customerId: "SUB1",
        userId: "user_1",
        planId: "pro",
        occurredAt: new Date("2026-09-30T00:00:00.000Z"),
      });
      for (const cancelled of [
        "USER_CANCELLED",
        "MERCHANT_CANCELLED",
        "CHANNEL_CANCELLED",
        "PLATFORM_CANCELLED",
      ]) {
        expect(
          s.provider.parseEvent(
            status(cancelled, {
              productInfo: { nextPaymentDateTime: "2026-10-29T08:01:00.000Z" },
            }),
          ),
        ).toMatchObject({
          type: "subscription.canceled",
          currentPeriodEnd: new Date("2026-10-29T08:01:00.000Z"),
        });
      }
      expect(s.provider.parseEvent(status("EXPIRED"))).toMatchObject({
        type: "subscription.expired",
      });
      expect(s.provider.parseEvent(status("CLOSE"))).toMatchObject({
        type: "subscription.expired",
      });
      expect(s.provider.parseEvent(status("IN_PROGRESS"))).toBeNull();
      expect(
        s.provider.parseEvent(status("AUTHORIZATION_REQUIRED")),
      ).toBeNull();
    });

    test("退款：部分 / 全额 → refund.created（对应原订单）；进行中和失败的忽略", () => {
      expect(
        s.provider.parseEvent(refund("ORDER_PARTIALLY_REFUNDED")),
      ).toMatchObject({
        type: "refund.created",
        orderId: "ACQ1",
        refundId: "REF1",
        amount: 4975,
        currency: "USD",
        eventId: "REFUND_NOTIFICATION:REF1:ORDER_PARTIALLY_REFUNDED",
        occurredAt: new Date("2026-10-01T00:00:00.000Z"),
      });
      expect(
        s.provider.parseEvent(refund("ORDER_FULLY_REFUNDED", "199.00")),
      ).toMatchObject({ type: "refund.created", amount: 19900 });
      expect(s.provider.parseEvent(refund("REFUND_IN_PROGRESS"))).toBeNull();
      expect(s.provider.parseEvent(refund("ORDER_REFUND_FAILED"))).toBeNull();
    });

    test("不关心或结构不对的 payload 返回 null", () => {
      for (const payload of [
        null,
        "x",
        {},
        { eventType: "PAYMENT_NOTIFICATION" },
        {
          eventType: "PAYMENT_NOTIFICATION",
          result: { orderStatus: "PAY_SUCCESS" },
        },
        {
          eventType: "SUBSCRIPTION_PERIOD_CHANGED_NOTIFICATION",
          result: { subscriptionId: "S" },
        },
        { eventType: "CHARGEBACK_NOTIFICATION", result: { id: "x" } },
        {
          eventType: "SUBSCRIPTION_STATUS_NOTIFICATION",
          result: { subscriptionStatus: "ACTIVE" },
        },
      ]) {
        expect(s.provider.parseEvent(payload)).toBeNull();
      }
    });
  });

  describe("门户与取消", () => {
    test("门户：按订阅 ID 现取管理链接；拿不到就抛错", async () => {
      s.http.reply("/api/v1/subscription/manage", {
        data: {
          managementUrl: "https://cashier-sandbox.waffo.com/manage/1",
          expiredAt: "x",
        },
      });
      await expect(s.provider.getPortalUrl("SUB1")).resolves.toBe(
        "https://cashier-sandbox.waffo.com/manage/1",
      );
      expect(s.http.requests[0]!.body).toMatchObject({
        subscriptionId: "SUB1",
      });

      s.http.reply("/api/v1/subscription/manage", {
        code: "A0028",
        msg: "processing",
      });
      await expect(s.provider.getPortalUrl("SUB1")).rejects.toThrow(/A0028/);
    });

    test("取消：成功直接返回；接口报错但订阅已经结束视为成功（便于重试）；仍在进行就抛错", async () => {
      s.http.reply("/api/v1/subscription/cancel", {
        data: { subscriptionId: "SUB1" },
      });
      await expect(
        s.provider.cancelSubscription("SUB1"),
      ).resolves.toBeUndefined();

      s.http.reply("/api/v1/subscription/cancel", {
        code: "A0025",
        msg: "not active",
      });
      s.http.reply("/api/v1/subscription/inquiry", {
        data: { subscriptionId: "SUB1", subscriptionStatus: "USER_CANCELLED" },
      });
      await expect(
        s.provider.cancelSubscription("SUB1"),
      ).resolves.toBeUndefined();

      s.http.reply("/api/v1/subscription/cancel", {
        code: "E0001",
        msg: "unknown",
      });
      s.http.reply("/api/v1/subscription/inquiry", {
        data: { subscriptionId: "SUB1", subscriptionStatus: "ACTIVE" },
      });
      // E0001（结果未知）SDK 直接抛异常；查到订阅仍在进行，把原始错误抛出去，由调用方重试。
      await expect(s.provider.cancelSubscription("SUB1")).rejects.toThrow();
      expect(
        s.http.requests.filter(
          (r) => r.path === "/api/v1/subscription/inquiry",
        ),
      ).toHaveLength(2);
    });
  });
});
