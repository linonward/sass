// @vitest-environment node
import { createHmac } from "node:crypto";

import { describe, expect, test, vi } from "vitest";

import siteConfig from "../../../../site.config";
import { WebhookVerificationError } from "../provider";
import {
  lemonSqueezySample,
  type LemonSqueezySampleEvent,
} from "./__fixtures__/lemonsqueezy-webhooks";
import {
  createLemonSqueezyProvider,
  parseLemonSqueezyEvent,
} from "./lemonsqueezy";
import {
  createLemonSqueezyClient,
  LemonSqueezyApiError,
  type LemonSqueezyFetch,
} from "./lemonsqueezy/client";

const SECRET = "ls_whsec_test_secret";
const STORE_ID = "12345";

/** 站点配置里的产品 ID（Creem 是产品，Lemon Squeezy 是变体）。CI 用环境变量覆盖，所以按运行时读。 */
function providerProductId(planId: string) {
  const plan = siteConfig.billing.plans.find((item) => item.id === planId);
  if (!plan?.providerProductId) throw new Error(`plan ${planId} has no id`);
  return plan.providerProductId;
}

function signedRequest(
  body: string,
  signature = createHmac("sha256", SECRET).update(body).digest("hex"),
) {
  return new Request("https://example.test/api/webhooks/lemonsqueezy", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(signature !== "" && { "X-Signature": signature }),
    },
    body,
  });
}

function fakeClient() {
  return { request: vi.fn() };
}

const provider = (client = fakeClient()) =>
  createLemonSqueezyProvider({
    apiKey: "ls_api_key",
    webhookSecret: SECRET,
    storeId: STORE_ID,
    client,
  });

/** 注入结账时传的 `checkout_data.custom`（真实投递里在 meta.custom_data）。 */
function withCustomData(
  sample: ReturnType<typeof lemonSqueezySample>,
  custom: Record<string, unknown>,
) {
  sample.meta.custom_data = custom;
  return sample;
}

/** 官方示例里的 variant_id 是文档用的 1 / 2，换成站点配置里的变体 ID 才能命中反查分支。 */
function withVariant(
  sample: ReturnType<typeof lemonSqueezySample>,
  variantId: unknown,
) {
  (
    sample.data.attributes.first_order_item as { variant_id: unknown }
  ).variant_id = variantId;
  return sample;
}

describe("verifyWebhook", () => {
  const body = JSON.stringify(lemonSqueezySample("order_created"));

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

  test("缺少 X-Signature 时拒绝", async () => {
    await expect(
      provider().verifyWebhook(signedRequest(body, "")),
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  test("请求体被篡改时拒绝", async () => {
    const signature = createHmac("sha256", SECRET).update(body).digest("hex");
    const tampered = body.replace('"status":"paid"', '"status":"refunded"');
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

  // timingSafeEqual 对长度不等的 buffer 会抛 TypeError，必须先比长度；
  // 这里断言拿到的是 WebhookVerificationError（而不是那种内部异常）。
  test("签名长度不对时拒绝（不是抛 TypeError）", async () => {
    await expect(
      provider().verifyWebhook(signedRequest(body, "abc")),
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  test("签名有效但不是 JSON 时拒绝", async () => {
    await expect(
      provider().verifyWebhook(signedRequest("not json")),
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });
});

describe("HTTP 客户端", () => {
  test("带 Bearer 和 JSON:API 媒体类型，解析 JSON:API 响应", async () => {
    const fakeFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { id: "1" } }), { status: 200 }),
    ) as unknown as LemonSqueezyFetch;
    const client = createLemonSqueezyClient({
      apiKey: "ls_api_key",
      fetch: fakeFetch,
    });

    await expect(
      client.request("POST", "/v1/checkouts", { data: {} }),
    ).resolves.toEqual({ data: { id: "1" } });

    const [url, init] = (fakeFetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("https://api.lemonsqueezy.com/v1/checkouts");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer ls_api_key",
      Accept: "application/vnd.api+json",
      "Content-Type": "application/vnd.api+json",
    });
    expect(init.body).toBe(JSON.stringify({ data: {} }));
  });

  test("GET 不带 Content-Type 和 body", async () => {
    const fakeFetch = vi.fn(
      async () => new Response("{}", { status: 200 }),
    ) as unknown as LemonSqueezyFetch;
    await createLemonSqueezyClient({ apiKey: "k", fetch: fakeFetch }).request(
      "GET",
      "/v1/customers/1",
    );
    const [, init] = (fakeFetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [URL, RequestInit];
    expect(init.headers).not.toHaveProperty("Content-Type");
    expect(init.body).toBeUndefined();
  });

  test("非 2xx 抛错，带状态码和响应体片段", async () => {
    const fakeFetch = vi.fn(
      async () =>
        new Response('{"errors":[{"detail":"nope"}]}', { status: 422 }),
    ) as unknown as LemonSqueezyFetch;
    const error = await createLemonSqueezyClient({
      apiKey: "k",
      fetch: fakeFetch,
    })
      .request("POST", "/v1/checkouts", {})
      .catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(LemonSqueezyApiError);
    expect((error as LemonSqueezyApiError).status).toBe(422);
    expect((error as LemonSqueezyApiError).message).toContain("nope");
  });

  // 不重试是刻意的：结账由用户点击触发，webhook 由 Lemon Squeezy 自己退避重推。
  test("429 也不重试：只发一次请求", async () => {
    const fakeFetch = vi.fn(
      async () => new Response("slow down", { status: 429 }),
    ) as unknown as LemonSqueezyFetch;
    await expect(
      createLemonSqueezyClient({ apiKey: "k", fetch: fakeFetch }).request(
        "GET",
        "/v1/customers/1",
      ),
    ).rejects.toBeInstanceOf(LemonSqueezyApiError);
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });
});

describe("parseLemonSqueezyEvent：官方示例 payload 的映射", () => {
  test("order_created（变体反查不到套餐）：按一次性记订单", () => {
    expect(
      parseLemonSqueezyEvent(lemonSqueezySample("order_created")),
    ).toMatchObject({
      type: "checkout.completed",
      provider: "lemonsqueezy",
      eventId: "order_created:1:2023-01-17T12:26:23.000Z",
      occurredAt: new Date("2023-01-17T12:26:23.000Z"),
      checkoutId: "1",
      orderId: "1",
      customerId: "1",
      planId: undefined,
      // 官方示例的 total 是小数 1859.76（文档写的是整数分），按四舍五入兜底。
      amount: 1860,
      currency: "EUR",
    });
  });

  test("order_created（变体是一次性套餐）：记订单并映射套餐", () => {
    const sample = withVariant(
      lemonSqueezySample("order_created"),
      providerProductId("lifetime"),
    );
    expect(parseLemonSqueezyEvent(sample)).toMatchObject({
      type: "checkout.completed",
      planId: "lifetime",
      orderId: "1",
    });
  });

  test("order_created（变体是订阅套餐）：不记订单，首期由 invoice 事件记", () => {
    const sample = withVariant(
      lemonSqueezySample("order_created"),
      providerProductId("pro"),
    );
    expect(parseLemonSqueezyEvent(sample)).toMatchObject({
      type: "checkout.completed",
      planId: "pro",
      orderId: undefined,
    });
  });

  test("order_created：meta.custom_data 里的 userId / planId 优先", () => {
    const sample = withCustomData(lemonSqueezySample("order_created"), {
      userId: "user_1",
      planId: "pro",
    });
    expect(parseLemonSqueezyEvent(sample)).toMatchObject({
      userId: "user_1",
      planId: "pro",
    });
  });

  test("subscription_created（on_trial）→ subscription.active", () => {
    const sample = withCustomData(lemonSqueezySample("subscription_created"), {
      userId: "user_1",
    });
    expect(parseLemonSqueezyEvent(sample)).toMatchObject({
      type: "subscription.active",
      subscriptionId: "1",
      customerId: "2",
      userId: "user_1",
      currentPeriodEnd: new Date("2023-01-24T12:43:48.000Z"),
    });
  });

  test("subscription_created：变体反查得到套餐", () => {
    const sample = lemonSqueezySample("subscription_created");
    sample.data.attributes.variant_id = providerProductId("pro");
    expect(parseLemonSqueezyEvent(sample)).toMatchObject({
      type: "subscription.active",
      planId: "pro",
    });
  });

  test.each<LemonSqueezySampleEvent>([
    "subscription_updated",
    "subscription_resumed",
    "subscription_unpaused",
  ])("%s（status=active）→ subscription.active", (sample) => {
    expect(parseLemonSqueezyEvent(lemonSqueezySample(sample))).toMatchObject({
      type: "subscription.active",
      subscriptionId: "1",
      // 续费时间在 updated_at 之后，两点都要在。
      currentPeriodStart: new Date("2023-01-17T12:43:50.000Z"),
      currentPeriodEnd: new Date("2023-01-24T12:43:48.000Z"),
    });
  });

  test("subscription_updated 带着 cancelled 状态时按取消处理（不能复活已取消的订阅）", () => {
    const sample = lemonSqueezySample("subscription_created");
    sample.meta.event_name = "subscription_updated";
    sample.data.attributes.status = "cancelled";
    sample.data.attributes.ends_at = "2023-02-17T14:15:43.000000Z";
    expect(parseLemonSqueezyEvent(sample)).toMatchObject({
      type: "subscription.canceled",
      currentPeriodEnd: new Date("2023-02-17T14:15:43.000Z"),
    });
  });

  test("subscription_cancelled → subscription.canceled，用 ends_at 作为可用到的时间", () => {
    expect(
      parseLemonSqueezyEvent(lemonSqueezySample("subscription_cancelled")),
    ).toMatchObject({
      type: "subscription.canceled",
      subscriptionId: "3",
      customerId: "2",
      currentPeriodEnd: new Date("2023-02-17T14:15:43.000Z"),
    });
  });

  test("subscription_expired → subscription.expired", () => {
    expect(
      parseLemonSqueezyEvent(lemonSqueezySample("subscription_expired")),
    ).toMatchObject({
      type: "subscription.expired",
      subscriptionId: "1",
    });
  });

  test("subscription_paused 忽略（没有 paused 状态，也不能误判成付款失败）", () => {
    expect(
      parseLemonSqueezyEvent(lemonSqueezySample("subscription_paused")),
    ).toBeNull();
  });

  test("subscription_payment_success → subscription.renewed，orderId 用 invoice ID", () => {
    expect(
      parseLemonSqueezyEvent(
        lemonSqueezySample("subscription_payment_success"),
      ),
    ).toMatchObject({
      type: "subscription.renewed",
      subscriptionId: "1",
      customerId: "2",
      orderId: "1",
      currentPeriodStart: new Date("2023-01-17T12:43:51.000Z"),
      amount: 1500,
      currency: "USD",
      // invoice 事件不带 variant_id，也没有 custom_data：套餐留空。
      planId: undefined,
    });
  });

  test("subscription_payment_success：planId 只能来自 custom_data", () => {
    const sample = withCustomData(
      lemonSqueezySample("subscription_payment_success_renewal"),
      { userId: "user_1", planId: "pro" },
    );
    expect(parseLemonSqueezyEvent(sample)).toMatchObject({
      type: "subscription.renewed",
      orderId: "2",
      userId: "user_1",
      planId: "pro",
    });
  });

  test("subscription_payment_failed → payment.failed", () => {
    expect(
      parseLemonSqueezyEvent(lemonSqueezySample("subscription_payment_failed")),
    ).toMatchObject({
      type: "payment.failed",
      subscriptionId: "1",
      orderId: "2",
      amount: 1500,
      currency: "USD",
    });
  });

  test("subscription_payment_recovered 忽略（同一次收款会另有 success 事件）", () => {
    expect(
      parseLemonSqueezyEvent(
        lemonSqueezySample("subscription_payment_recovered"),
      ),
    ).toBeNull();
  });

  test("order_refunded（全额）→ refund.created", () => {
    expect(
      parseLemonSqueezyEvent(lemonSqueezySample("order_refunded")),
    ).toMatchObject({
      type: "refund.created",
      orderId: "2",
      refundId: "2023-02-01T10:00:00.000Z",
      amount: 1860,
      currency: "EUR",
      customerId: "1",
    });
  });

  test("subscription_payment_refunded（全额）→ refund.created", () => {
    expect(
      parseLemonSqueezyEvent(
        lemonSqueezySample("subscription_payment_refunded"),
      ),
    ).toMatchObject({
      type: "refund.created",
      orderId: "2",
      refundId: "2023-03-01T10:00:00.000Z",
      amount: 1500,
      currency: "USD",
    });
  });

  // 已知缺口：refunded_amount 是累计值，下游的 refund 是增量，宁可漏也不重复计数。
  test.each<LemonSqueezySampleEvent>([
    "order_partially_refunded",
    "subscription_payment_partially_refunded",
  ])("%s（部分退款）不映射，返回 null", (sample) => {
    expect(parseLemonSqueezyEvent(lemonSqueezySample(sample))).toBeNull();
  });

  test("不关心的事件返回 null", () => {
    expect(
      parseLemonSqueezyEvent(lemonSqueezySample("license_key_created")),
    ).toBeNull();
  });

  test("结构不对的 payload 返回 null", () => {
    expect(parseLemonSqueezyEvent(null)).toBeNull();
    expect(parseLemonSqueezyEvent({})).toBeNull();
    expect(
      parseLemonSqueezyEvent({ meta: { event_name: "order_created" } }),
    ).toBeNull();
    expect(
      parseLemonSqueezyEvent({
        meta: {},
        data: { id: 1, attributes: {} },
      }),
    ).toBeNull();
    // 没有时间戳就不猜事件 ID（否则重推会绕过幂等）。
    expect(
      parseLemonSqueezyEvent({
        meta: { event_name: "order_created" },
        data: { id: 1, attributes: { total: 1 } },
      }),
    ).toBeNull();
  });

  test("重复投递得到同一个 eventId，资源更新后换一个", () => {
    const first = parseLemonSqueezyEvent(lemonSqueezySample("order_created"));
    const again = parseLemonSqueezyEvent(lemonSqueezySample("order_created"));
    expect(again?.eventId).toBe(first?.eventId);

    const changed = lemonSqueezySample("order_created");
    changed.data.attributes.updated_at = "2023-02-01T10:00:00.000000Z";
    expect(parseLemonSqueezyEvent(changed)?.eventId).not.toBe(first?.eventId);
  });
});

describe("createCheckout", () => {
  test("建结账会话：store + variant 关系，回跳地址在 product_options 里", async () => {
    const client = fakeClient();
    client.request.mockResolvedValueOnce({
      data: {
        id: "1",
        attributes: { url: "https://store.lemonsqueezy.com/checkout/1" },
      },
    });
    await expect(
      provider(client).createCheckout({
        userId: "user_1",
        planId: "pro",
        successUrl: "https://example.com/billing/success?checkout=1",
        cancelUrl: "https://example.com/#pricing",
        customerEmail: "a@example.com",
      }),
    ).resolves.toEqual({
      checkoutId: "1",
      url: "https://store.lemonsqueezy.com/checkout/1",
    });
    expect(client.request).toHaveBeenCalledWith("POST", "/v1/checkouts", {
      data: {
        type: "checkouts",
        attributes: {
          product_options: {
            redirect_url: "https://example.com/billing/success?checkout=1",
          },
          checkout_data: {
            email: "a@example.com",
            custom: { userId: "user_1", planId: "pro" },
          },
        },
        relationships: {
          store: { data: { type: "stores", id: STORE_ID } },
          variant: {
            data: { type: "variants", id: providerProductId("pro") },
          },
        },
      },
    });
  });

  test("没有邮箱时不带 email", async () => {
    const client = fakeClient();
    client.request.mockResolvedValueOnce({
      data: { id: "1", attributes: { url: "https://x.test/1" } },
    });
    await provider(client).createCheckout({
      userId: "user_1",
      planId: "pro",
      successUrl: "https://x.test/success",
      cancelUrl: "https://x.test/#pricing",
    });
    const body = client.request.mock.calls[0]?.[2] as {
      data: { attributes: { checkout_data: Record<string, unknown> } };
    };
    expect(body.data.attributes.checkout_data).toEqual({
      custom: { userId: "user_1", planId: "pro" },
    });
  });

  test("免费套餐没有变体 ID 时抛错", async () => {
    await expect(
      provider().createCheckout({
        userId: "user_1",
        planId: "free",
        successUrl: "https://x.test",
        cancelUrl: "https://x.test",
      }),
    ).rejects.toThrow(/providerProductId/);
  });

  test("响应里没有 url 时抛错", async () => {
    const client = fakeClient();
    client.request.mockResolvedValueOnce({ data: { id: "1", attributes: {} } });
    await expect(
      provider(client).createCheckout({
        userId: "user_1",
        planId: "pro",
        successUrl: "https://x.test",
        cancelUrl: "https://x.test",
      }),
    ).rejects.toThrow(/url/);
  });
});

describe("getPortalUrl", () => {
  test("返回客户门户链接（预签名）", async () => {
    const client = fakeClient();
    client.request.mockResolvedValueOnce({
      data: {
        id: "2",
        attributes: {
          urls: {
            customer_portal:
              "https://store.lemonsqueezy.com/billing?signature=x",
          },
        },
      },
    });
    await expect(provider(client).getPortalUrl("2")).resolves.toBe(
      "https://store.lemonsqueezy.com/billing?signature=x",
    );
    expect(client.request).toHaveBeenCalledWith("GET", "/v1/customers/2");
  });

  // 客户没有任何订阅时 customer_portal 是 null：这是「客户记录在但订阅都结束了」，
  // 和 openPortal 返回 no_customer（没有客户记录）是两条不同的边界，这里只能明确报错。
  test("customer_portal 为 null 时抛错（客户没有订阅）", async () => {
    const client = fakeClient();
    client.request.mockResolvedValueOnce({
      data: { id: "2", attributes: { urls: { customer_portal: null } } },
    });
    await expect(provider(client).getPortalUrl("2")).rejects.toThrow(
      /customer_portal/,
    );
  });
});

describe("cancelSubscription", () => {
  test("有效订阅：DELETE 取消后续扣款", async () => {
    const client = fakeClient();
    client.request.mockResolvedValueOnce({
      data: { attributes: { status: "active" } },
    });
    await provider(client).cancelSubscription("1");
    expect(client.request).toHaveBeenNthCalledWith(
      1,
      "GET",
      "/v1/subscriptions/1",
    );
    expect(client.request).toHaveBeenNthCalledWith(
      2,
      "DELETE",
      "/v1/subscriptions/1",
    );
  });

  test.each(["cancelled", "expired"])(
    "已经是 %s：不再取消，视为成功",
    async (status) => {
      const client = fakeClient();
      client.request.mockResolvedValueOnce({
        data: { attributes: { status } },
      });
      await provider(client).cancelSubscription("1");
      expect(client.request).toHaveBeenCalledTimes(1);
    },
  );

  test("订阅不存在（GET 404）：视为成功", async () => {
    const client = fakeClient();
    client.request.mockRejectedValueOnce(new LemonSqueezyApiError(404, "{}"));
    await expect(
      provider(client).cancelSubscription("1"),
    ).resolves.toBeUndefined();
  });

  test("DELETE 时 404：也视为成功", async () => {
    const client = fakeClient();
    client.request
      .mockResolvedValueOnce({ data: { attributes: { status: "active" } } })
      .mockRejectedValueOnce(new LemonSqueezyApiError(404, "{}"));
    await expect(
      provider(client).cancelSubscription("1"),
    ).resolves.toBeUndefined();
  });

  test("其他错误：向上抛出", async () => {
    const client = fakeClient();
    client.request.mockRejectedValueOnce(new LemonSqueezyApiError(500, "boom"));
    await expect(provider(client).cancelSubscription("1")).rejects.toThrow(
      /500/,
    );
  });
});

test("provider.id 是 lemonsqueezy", () => {
  expect(provider().id).toBe("lemonsqueezy");
});

test("parseEvent 就是 parseLemonSqueezyEvent", () => {
  expect(provider().parseEvent(lemonSqueezySample("order_created"))).toEqual(
    parseLemonSqueezyEvent(lemonSqueezySample("order_created")),
  );
});
