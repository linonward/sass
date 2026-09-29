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

// Multilingual site, to cover redirect URLs with a locale prefix.
vi.mock("@/core/i18n/routing", () => ({
  routing: { locales: ["en", "de"], defaultLocale: "en" },
}));
// Use plans configured with real product IDs (site.config.ts has placeholders, which can't check out).
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

  test("creates checkout with the user, the plan and a default-locale success page", async () => {
    await expect(checkout("pro")).resolves.toEqual({
      ok: true,
      url: expect.stringContaining("https://fake.test/checkout/"),
    });
    expect(fake.checkouts).toEqual([
      {
        userId,
        planId: "pro",
        customerEmail: "buyer@example.com",
        // Include the plan and checkout time: when the provider's redirect carries no order ID, the
        // success page uses them to locate it (see status.ts).
        successUrl: expect.stringMatching(
          /^https:\/\/sass\.test\/billing\/success\?plan=pro&since=\d+$/,
        ),
        cancelUrl: "https://sass.test/#pricing",
      },
    ]);
  });

  test("non-default locales get a prefixed redirect URL; unsupported locales fall back to the default", async () => {
    await checkout("pro", { locale: "de" });
    await checkout("lifetime", { locale: "xx" });
    expect(fake.checkouts.map((c) => c.successUrl.split("?")[0])).toEqual([
      "https://sass.test/de/billing/success",
      "https://sass.test/billing/success",
    ]);
    expect(fake.checkouts[0]!.cancelUrl).toBe("https://sass.test/de#pricing");
  });

  test.each([
    ["no provider configured", "pro", null, "billing_not_configured", 503],
    ["unknown plan", "nope", undefined, "invalid_plan", 400],
    ["not a string", 42, undefined, "invalid_plan", 400],
    ["free plan", "free", undefined, "free_plan", 400],
    ["placeholder product ID", "draft", undefined, "plan_not_configured", 503],
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

  test("rejects subscribing again when there is already an active subscription", async () => {
    await addSubscription("active");
    await expect(checkout("pro")).resolves.toMatchObject({
      ok: false,
      error: "already_subscribed",
      status: 409,
    });
  });

  test("a canceled but not yet expired subscription still counts as active; an expired one doesn't", async () => {
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

  test("a one-time plan can't be bought again once purchased", async () => {
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

  test("rate limiting: over the threshold returns 429 + retryAfter and creates no checkout session", async () => {
    const limitAfter = 2;
    let calls = 0;
    const checkRateLimit = async (): Promise<RateLimitResult> =>
      ++calls > limitAfter
        ? { ok: false, reason: "limited", retryAfter: 7 }
        : { ok: true, retryAfter: 0 };

    const first = await checkout("pro", { checkRateLimit });
    const second = await checkout("pro", { checkRateLimit });
    expect(first).toMatchObject({ ok: true });
    // Within the window the same session is reused: the second request doesn't create another order
    // at the provider.
    expect(second).toEqual(first);
    expect(fake.checkouts).toHaveLength(1);

    // Request N+1: rejected, and never reaches the provider.
    await expect(checkout("pro", { checkRateLimit })).resolves.toEqual({
      ok: false,
      error: "rate_limited",
      status: 429,
      retryAfter: 7,
    });
    expect(fake.checkouts).toHaveLength(1);

    // When Redis is unavailable (failMode: closed) it's 503, also with retryAfter.
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

  test("a concurrent double-click creates only one session: both requests get the same URL", async () => {
    // Make order creation a bit slow to force a real interleaving: both requests enter the create path
    // while nothing is committed yet. Without the row lock, neither would find a session and each
    // would create an order — and the user could end up paying on both pages.
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

  test("creates a new order after the session expires", async () => {
    const first = await checkout("pro");
    expect(first).toMatchObject({ ok: true });

    const later = await checkout("pro", {
      now: new Date(Date.now() + CHECKOUT_SESSION_TTL_MS + 1000),
    });
    expect(later).toMatchObject({ ok: true });
    expect(later).not.toEqual(first);
    expect(fake.checkouts).toHaveLength(2);
  });

  test("customer portal: 404 without a customer record, otherwise returns the link", async () => {
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

  test("production always uses the configured domain and doesn't trust the request Host", () => {
    expect(
      billingOrigin(request, { VERCEL_ENV: "production" }, "example.com"),
    ).toBe("https://example.com");
  });

  test("local and preview use the request's own origin", () => {
    expect(
      billingOrigin(request, { VERCEL_ENV: "preview" }, "example.com"),
    ).toBe("https://preview-abc.vercel.app");
    expect(
      billingOrigin(new Request("http://localhost:3000/x"), {}, "d.com"),
    ).toBe("http://localhost:3000");
  });
});
