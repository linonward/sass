// @vitest-environment node
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";

import { createDbClient, type DbClient } from "@/core/db/client";
import {
  billingCustomers,
  orders,
  subscriptions,
  user,
} from "@/core/db/schema";
import type {
  RateLimitIdentifiers,
  RateLimitResult,
} from "@/core/ratelimit/limiter";

import {
  billingOrigin,
  CHECKOUT_SESSION_TTL_MS,
  openPortal,
  startCheckout,
} from "./checkout";
import { FakeProvider } from "./testing/fake-provider";

// 多语言站点，覆盖带前缀的回跳地址。
vi.mock("@/core/i18n/routing", () => ({
  routing: { locales: ["en", "de"], defaultLocale: "en" },
}));
// 用配置了真实产品 ID 的套餐（site.config.ts 里是占位值，不允许结账）。
vi.mock("./plans", () => {
  const plans = [
    { id: "free", price: 0, type: "subscription", credits: 0 },
    {
      id: "pro",
      price: 19,
      type: "subscription",
      providerProductId: "prod_pro",
      credits: 2000,
    },
    {
      id: "lifetime",
      price: 199,
      type: "one_time",
      providerProductId: "prod_life",
      credits: 2000,
    },
    {
      id: "draft",
      price: 9,
      type: "one_time",
      providerProductId: "prod_placeholder_x",
      credits: 0,
    },
  ];
  return {
    getPlan: (id: string) => plans.find((plan) => plan.id === id),
    planByProductId: (id: string) =>
      plans.find((plan) => plan.providerProductId === id),
  };
});

const url = process.env.DATABASE_URL_TEST;
if (!url && process.env.CI) {
  throw new Error("DATABASE_URL_TEST must be set in CI");
}

describe.skipIf(!url)("startCheckout / openPortal", () => {
  let client: DbClient;
  let userId: string;
  let fake: FakeProvider;
  const origin = "https://sass.test";

  const checkout = (
    planId: unknown,
    extra: {
      locale?: string;
      provider?: FakeProvider | null;
      now?: Date;
      checkRateLimit?: (
        policy: string,
        identifiers: RateLimitIdentifiers,
      ) => Promise<RateLimitResult>;
    } = {},
  ) =>
    startCheckout({
      db: client.db,
      provider: extra.provider === undefined ? fake : extra.provider,
      user: { id: userId, email: "buyer@example.com" },
      planId,
      locale: extra.locale,
      origin,
      checkRateLimit:
        extra.checkRateLimit ?? (async () => ({ ok: true, retryAfter: 0 })),
      now: extra.now ?? new Date("2026-06-01T00:00:00Z"),
    });

  beforeAll(() => {
    client = createDbClient(url!);
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    fake = new FakeProvider("secret", `fake-${randomUUID().slice(0, 8)}`);
    userId = randomUUID();
    await client.db.insert(user).values({
      id: userId,
      name: "Checkout Test",
      email: `checkout-${userId}@example.com`,
      emailVerified: true,
    });
  });

  afterEach(async () => {
    await client.db.delete(user).where(eq(user.id, userId));
  });

  test("创建结账：带上用户、套餐和默认语言的成功页", async () => {
    await expect(checkout("pro")).resolves.toEqual({
      ok: true,
      url: expect.stringContaining("https://fake.test/checkout/"),
    });
    expect(fake.checkouts).toEqual([
      {
        userId,
        planId: "pro",
        customerEmail: "buyer@example.com",
        successUrl: "https://sass.test/billing/success",
        cancelUrl: "https://sass.test/#pricing",
      },
    ]);
  });

  test("非默认语言的回跳地址带语言前缀；不支持的语言回退到默认语言", async () => {
    await checkout("pro", { locale: "de" });
    await checkout("lifetime", { locale: "xx" });
    expect(fake.checkouts.map((c) => c.successUrl)).toEqual([
      "https://sass.test/de/billing/success",
      "https://sass.test/billing/success",
    ]);
    expect(fake.checkouts[0]!.cancelUrl).toBe("https://sass.test/de#pricing");
  });

  test.each([
    ["没配置服务商", "pro", null, "billing_not_configured", 503],
    ["未知套餐", "nope", undefined, "invalid_plan", 400],
    ["非字符串", 42, undefined, "invalid_plan", 400],
    ["免费套餐", "free", undefined, "free_plan", 400],
    ["占位产品 ID", "draft", undefined, "plan_not_configured", 503],
  ] as const)("%s → %s", async (_, planId, provider, error, status) => {
    await expect(
      checkout(planId, {
        provider: provider as FakeProvider | null | undefined,
      }),
    ).resolves.toEqual({ ok: false, error, status });
    expect(fake.checkouts).toHaveLength(0);
  });

  async function addSubscription(
    status: "active" | "canceled" | "expired",
    periodEnd?: Date,
  ) {
    await client.db.insert(subscriptions).values({
      userId,
      provider: fake.id,
      providerSubscriptionId: `sub_${randomUUID().slice(0, 8)}`,
      status,
      currentPeriodEnd: periodEnd,
      lastEventAt: new Date(),
    });
  }

  test("已有有效订阅时拒绝再订阅", async () => {
    await addSubscription("active");
    await expect(checkout("pro")).resolves.toMatchObject({
      ok: false,
      error: "already_subscribed",
      status: 409,
    });
  });

  test("已取消但未到期的订阅仍算有效；已到期的不算", async () => {
    await addSubscription("canceled", new Date("2026-07-01T00:00:00Z"));
    await expect(checkout("pro")).resolves.toMatchObject({
      error: "already_subscribed",
    });

    await client.db
      .delete(subscriptions)
      .where(eq(subscriptions.userId, userId));
    await addSubscription("canceled", new Date("2026-05-01T00:00:00Z"));
    await addSubscription("expired");
    await expect(checkout("pro")).resolves.toMatchObject({ ok: true });
  });

  test("一次性套餐买过就不能再买", async () => {
    await client.db.insert(orders).values({
      userId,
      provider: fake.id,
      providerOrderId: `ord_${randomUUID().slice(0, 8)}`,
      planId: "lifetime",
      status: "paid",
    });
    await expect(checkout("lifetime")).resolves.toMatchObject({
      error: "already_purchased",
      status: 409,
    });
  });

  test("限流：超过阈值返回 429 + retryAfter，不再建结账会话", async () => {
    const limitAfter = 2;
    let calls = 0;
    const checkRateLimit = async (): Promise<RateLimitResult> =>
      ++calls > limitAfter
        ? { ok: false, reason: "limited", retryAfter: 7 }
        : { ok: true, retryAfter: 0 };

    const first = await checkout("pro", { checkRateLimit });
    const second = await checkout("pro", { checkRateLimit });
    expect(first).toMatchObject({ ok: true });
    // 窗口内复用同一个会话：第二次请求不会再向服务商建单。
    expect(second).toEqual(first);
    expect(fake.checkouts).toHaveLength(1);

    // 第 N+1 次：拒绝，且不落到服务商。
    await expect(checkout("pro", { checkRateLimit })).resolves.toEqual({
      ok: false,
      error: "rate_limited",
      status: 429,
      retryAfter: 7,
    });
    expect(fake.checkouts).toHaveLength(1);

    // Redis 不可用（failMode: closed）时是 503，同样带 retryAfter。
    const unavailable = await checkout("pro", {
      checkRateLimit: async () => ({
        ok: false,
        reason: "unavailable",
        retryAfter: 3,
      }),
    });
    expect(unavailable).toEqual({
      ok: false,
      error: "rate_limited",
      status: 503,
      retryAfter: 3,
    });
  });

  test("并发双击只建一个会话：两个请求拿到同一个 URL", async () => {
    // 建单慢一点，逼出真正的交错：两个请求都在「还没提交」时进入创建流程。
    // 没有行锁的话两边都会查不到会话、各建一单 —— 用户就可能两个页面都付款。
    class SlowProvider extends FakeProvider {
      override async createCheckout(
        input: Parameters<FakeProvider["createCheckout"]>[0],
      ) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return super.createCheckout(input);
      }
    }
    const slow = new SlowProvider("secret", "slow");

    const [a, b] = await Promise.all([
      checkout("pro", { provider: slow }),
      checkout("pro", { provider: slow }),
    ]);
    expect(a).toMatchObject({ ok: true });
    expect(b).toEqual(a);
    expect(slow.checkouts).toHaveLength(1);
  });

  test("会话过期后重新建单", async () => {
    const first = await checkout("pro");
    expect(first).toMatchObject({ ok: true });

    const later = await checkout("pro", {
      now: new Date(Date.now() + CHECKOUT_SESSION_TTL_MS + 1000),
    });
    expect(later).toMatchObject({ ok: true });
    expect(later).not.toEqual(first);
    expect(fake.checkouts).toHaveLength(2);
  });

  test("客户门户：没有客户记录时 404，有则返回链接", async () => {
    const portal = () => openPortal({ db: client.db, provider: fake, userId });
    await expect(portal()).resolves.toEqual({
      ok: false,
      error: "no_customer",
      status: 404,
    });

    await client.db.insert(billingCustomers).values({
      userId,
      provider: fake.id,
      providerCustomerId: "cust_42",
    });
    await expect(portal()).resolves.toEqual({
      ok: true,
      url: "https://fake.test/portal/cust_42",
    });
    await expect(
      openPortal({ db: client.db, provider: null, userId }),
    ).resolves.toMatchObject({ error: "billing_not_configured", status: 503 });
  });
});

describe("billingOrigin", () => {
  const request = new Request(
    "https://preview-abc.vercel.app/api/billing/checkout",
  );

  test("生产环境固定用配置的域名，不信任请求的 Host", () => {
    expect(
      billingOrigin(request, { VERCEL_ENV: "production" }, "example.com"),
    ).toBe("https://example.com");
  });

  test("本地和预览用请求自身的地址", () => {
    expect(
      billingOrigin(request, { VERCEL_ENV: "preview" }, "example.com"),
    ).toBe("https://preview-abc.vercel.app");
    expect(
      billingOrigin(new Request("http://localhost:3000/x"), {}, "d.com"),
    ).toBe("http://localhost:3000");
  });
});
