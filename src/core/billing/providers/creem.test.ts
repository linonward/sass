// @vitest-environment node
import { createHmac } from "node:crypto";

import { APIError } from "creem/models/errors";
import { describe, expect, test, vi } from "vitest";

import { WebhookVerificationError } from "../provider";
import {
  creemSample,
  type CreemSampleEvent,
} from "./__fixtures__/creem-webhooks";
import {
  createCreemProvider,
  parseCreemEvent,
  type CreemClient,
} from "./creem";

const SECRET = "whsec_test_secret";

function signedRequest(
  body: string,
  signature = createHmac("sha256", SECRET).update(body).digest("hex"),
) {
  return new Request("https://example.test/api/webhooks/creem", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(signature !== "" && { "creem-signature": signature }),
    },
    body,
  });
}

function fakeClient(overrides: Partial<Record<string, unknown>> = {}) {
  const client = {
    checkouts: {
      create: vi.fn(async () => ({
        id: "ch_1",
        checkoutUrl: "https://checkout.creem.io/ch_1",
      })),
    },
    customers: {
      generateBillingLinks: vi.fn(async () => ({
        customerPortalLink: "https://creem.io/portal/cust_1",
      })),
    },
    subscriptions: {
      get: vi.fn(async () => ({ status: "active" })),
      cancel: vi.fn(async () => ({ status: "canceled" })),
    },
    ...overrides,
  };
  return client as unknown as CreemClient & typeof client;
}

const provider = (client = fakeClient()) =>
  createCreemProvider({
    apiKey: "creem_test_key",
    webhookSecret: SECRET,
    mode: "test",
    client,
  });

function apiError(status: number) {
  return new APIError("creem error", {
    response: new Response("{}", { status }),
    request: new Request("https://test-api.creem.io/v1/subscriptions"),
    body: "{}",
  });
}

describe("verifyWebhook", () => {
  const body = JSON.stringify(creemSample("checkout.completed"));

  test("签名正确时返回解析后的请求体", async () => {
    await expect(
      provider().verifyWebhook(signedRequest(body)),
    ).resolves.toEqual(JSON.parse(body));
  });

  test("签名错误时拒绝", async () => {
    await expect(
      provider().verifyWebhook(signedRequest(body, "0".repeat(64))),
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  test("缺少签名 header 时拒绝", async () => {
    await expect(
      provider().verifyWebhook(signedRequest(body, "")),
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  test("请求体被篡改时拒绝", async () => {
    const signature = createHmac("sha256", SECRET).update(body).digest("hex");
    const tampered = body.replace('"amount":1000', '"amount":1');
    expect(tampered).not.toBe(body);
    await expect(
      provider().verifyWebhook(signedRequest(tampered, signature)),
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  test("用别的 secret 签名时拒绝", async () => {
    const signature = createHmac("sha256", "other").update(body).digest("hex");
    await expect(
      provider().verifyWebhook(signedRequest(body, signature)),
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });
});

describe("parseCreemEvent：官方示例 payload 的映射", () => {
  test("checkout.completed（订阅结账）：不记订单，带订阅和客户", () => {
    const sample = creemSample("checkout.completed");
    sample.object.metadata = { userId: "user_1", planId: "pro" };
    expect(parseCreemEvent(sample)).toMatchObject({
      type: "checkout.completed",
      provider: "creem",
      eventId: "evt_5WHHcZPv7VS0YUsberIuOz",
      occurredAt: new Date(1728734325927),
      userId: "user_1",
      planId: "pro",
      customerId: "cust_1OcIK1GEuVvXZwD19tjq2z",
      checkoutId: "ch_4l0N34kxo16AhRKUHFUuXr",
      subscriptionId: "sub_6pC2lNB6joCRQIZ1aMrTpi",
      orderId: undefined,
      amount: 1000,
      currency: "EUR",
    });
  });

  test("checkout.completed（一次性购买）：记订单", () => {
    const sample = creemSample("checkout.completed");
    delete sample.object.subscription;
    expect(parseCreemEvent(sample)).toMatchObject({
      type: "checkout.completed",
      orderId: "ord_4aDwWXjMLpes4Kj4XqNnUA",
      subscriptionId: undefined,
    });
  });

  test("没有 metadata.planId 时按产品 ID 找套餐，找不到则为空", () => {
    const sample = creemSample("checkout.completed");
    expect(parseCreemEvent(sample)).toMatchObject({
      userId: undefined,
      planId: undefined,
    });
  });

  test("subscription.paid → subscription.renewed，带账期和交易 ID", () => {
    expect(parseCreemEvent(creemSample("subscription.paid"))).toMatchObject({
      type: "subscription.renewed",
      subscriptionId: "sub_6pC2lNB6joCRQIZ1aMrTpi",
      customerId: "cust_1OcIK1GEuVvXZwD19tjq2z",
      orderId: "tran_5yMaWzAl3jxuGJMCOrYWwk",
      currentPeriodStart: new Date("2024-10-12T11:58:38.000Z"),
      currentPeriodEnd: new Date("2024-11-12T11:58:38.000Z"),
      amount: 1000,
      currency: "EUR",
    });
  });

  test.each<[CreemSampleEvent, string]>([
    ["subscription.active", "subscription.active"],
    ["subscription.update", "subscription.active"],
    ["subscription.canceled", "subscription.canceled"],
    ["subscription.scheduled_cancel", "subscription.canceled"],
    ["subscription.expired", "subscription.expired"],
    ["subscription.past_due", "payment.failed"],
    ["subscription.unpaid", "payment.failed"],
  ])("%s → %s", (sample, type) => {
    const event = parseCreemEvent(creemSample(sample));
    expect(event).toMatchObject({ type, provider: "creem" });
    expect(event).toHaveProperty("subscriptionId");
  });

  test("scheduled_cancel 带上可用到的时间", () => {
    expect(
      parseCreemEvent(creemSample("subscription.scheduled_cancel")),
    ).toMatchObject({
      type: "subscription.canceled",
      currentPeriodEnd: new Date("2024-11-12T11:58:38.000Z"),
    });
  });

  test("subscription.update 不是 active 时忽略", () => {
    const sample = creemSample("subscription.update");
    sample.object.status = "paused";
    expect(parseCreemEvent(sample)).toBeNull();
  });

  test("refund.created（订阅付款）：按交易 ID 对应订单", () => {
    expect(parseCreemEvent(creemSample("refund.created"))).toMatchObject({
      type: "refund.created",
      refundId: "ref_3DB9NQFvk18TJwSqd0N6bd",
      orderId: "tran_5yMaWzAl3jxuGJMCOrYWwk",
      amount: 1210,
      currency: "EUR",
      customerId: "cust_1OcIK1GEuVvXZwD19tjq2z",
    });
  });

  test("refund.created（一次性购买）：按订单 ID", () => {
    const sample = creemSample("refund.created");
    const transaction = sample.object.transaction as Record<string, unknown>;
    delete transaction.subscription;
    delete sample.object.subscription;
    expect(parseCreemEvent(sample)).toMatchObject({
      orderId: "ord_4aDwWXjMLpes4Kj4XqNnUA",
    });
  });

  test("refund 的 userId 从结账 metadata 读取", () => {
    const sample = creemSample("refund.created");
    (sample.object.checkout as Record<string, unknown>).metadata = {
      userId: "user_9",
    };
    expect(parseCreemEvent(sample)).toMatchObject({ userId: "user_9" });
  });

  test.each<CreemSampleEvent>(["dispute.created", "subscription.trialing"])(
    "不关心的事件 %s 返回 null",
    (sample) => {
      expect(parseCreemEvent(creemSample(sample))).toBeNull();
    },
  );

  test("结构不对的请求体返回 null", () => {
    expect(parseCreemEvent(null)).toBeNull();
    expect(parseCreemEvent({ eventType: "checkout.completed" })).toBeNull();
  });
});

describe("createCheckout", () => {
  test("传入产品 ID、回跳地址、邮箱和 metadata", async () => {
    const client = fakeClient();
    const checkout = await provider(client).createCheckout({
      userId: "user_1",
      planId: "pro",
      successUrl: "https://sass.linonward.com/dashboard?checkout=success",
      cancelUrl: "https://sass.linonward.com/#pricing",
      customerEmail: "a@example.com",
    });
    expect(checkout).toEqual({
      checkoutId: "ch_1",
      url: "https://checkout.creem.io/ch_1",
    });
    expect(client.checkouts.create).toHaveBeenCalledWith({
      productId: "prod_placeholder_pro",
      requestId: "user_1:pro",
      successUrl: "https://sass.linonward.com/dashboard?checkout=success",
      customer: { email: "a@example.com" },
      metadata: { userId: "user_1", planId: "pro" },
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
});

describe("cancelSubscription", () => {
  test("有效订阅：立即取消", async () => {
    const client = fakeClient();
    await provider(client).cancelSubscription("sub_1");
    expect(client.subscriptions.cancel).toHaveBeenCalledWith("sub_1", {
      mode: "immediate",
    });
  });

  test.each(["canceled", "scheduled_cancel"])(
    "已经是 %s：不再取消，视为成功",
    async (status) => {
      const client = fakeClient();
      client.subscriptions.get.mockResolvedValueOnce({ status });
      await provider(client).cancelSubscription("sub_1");
      expect(client.subscriptions.cancel).not.toHaveBeenCalled();
    },
  );

  test("订阅不存在（404）：视为成功", async () => {
    const client = fakeClient();
    client.subscriptions.get.mockRejectedValueOnce(apiError(404));
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
});

test("getPortalUrl 返回客户门户链接", async () => {
  const client = fakeClient();
  await expect(provider(client).getPortalUrl("cust_1")).resolves.toBe(
    "https://creem.io/portal/cust_1",
  );
  expect(client.customers.generateBillingLinks).toHaveBeenCalledWith({
    customerId: "cust_1",
  });
});
