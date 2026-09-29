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
import { creditTransactions, user } from "@/core/db/schema";

import { handleBillingEvent } from "./handle-event";
import { getBillingOverview, ownedPlans } from "./overview";
import {
  createFakeBillingProvider,
  fakePayment,
  signFakeSession,
  verifyFakeSession,
  type FakeCheckoutSession,
} from "./providers/fake";
import { getCheckoutStatus } from "./status";

vi.mock("./plans", () => {
  const plans = [
    {
      id: "free",
      price: 0,
      type: "subscription",
      interval: "month",
      credits: 0,
    },
    {
      id: "pro",
      price: 19,
      type: "subscription",
      interval: "month",
      providerProductId: "prod_pro",
      credits: 2000,
    },
    {
      id: "lifetime",
      price: 199,
      type: "one_time",
      interval: "once",
      providerProductId: "prod_life",
      credits: 500,
    },
  ];
  return {
    getPlan: (id: string) => plans.find((plan) => plan.id === id),
    planByProductId: (id: string) =>
      plans.find((plan) => plan.providerProductId === id),
  };
});

describe("fake checkout session", () => {
  const session: FakeCheckoutSession = {
    checkoutId: "chk_fake_1",
    userId: "user_1",
    planId: "pro",
    successUrl: "http://localhost:3000/billing/success",
  };

  test("a signed value can be read back unchanged", () => {
    expect(verifyFakeSession(signFakeSession(session))).toEqual(session);
  });

  test("rejects tampered, unsigned and garbled values", () => {
    const token = signFakeSession(session);
    const [body = "", signature = ""] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...session, userId: "someone_else" }),
    ).toString("base64url");
    expect(verifyFakeSession(`${forged}.${signature}`)).toBeNull();
    expect(verifyFakeSession(body)).toBeNull();
    expect(verifyFakeSession("x.y")).toBeNull();
    expect(verifyFakeSession(null)).toBeNull();
  });

  test("the checkout URL is the on-site mock payment page, and the customer portal is on-site too", async () => {
    const provider = createFakeBillingProvider();
    const { url } = await provider.createCheckout({
      userId: "user_1",
      planId: "pro",
      successUrl: session.successUrl,
      cancelUrl: "http://localhost:3000/#pricing",
    });
    expect(url).toMatch(/^\/api\/billing\/fake\/checkout\?token=/);
    const token = new URL(url, "http://x").searchParams.get("token");
    expect(verifyFakeSession(token)).toMatchObject({
      userId: "user_1",
      planId: "pro",
    });
    await expect(provider.getPortalUrl("cust_1")).resolves.toBe(
      "/api/billing/fake/portal?customer=cust_1",
    );
  });

  test("free and unknown plans produce no payment", () => {
    const provider = createFakeBillingProvider();
    expect(fakePayment(provider, { ...session, planId: "free" })).toBeNull();
    expect(fakePayment(provider, { ...session, planId: "nope" })).toBeNull();
  });
});

const url = process.env.DATABASE_URL_TEST;
if (!url && process.env.CI) {
  throw new Error("DATABASE_URL_TEST must be set in CI");
}

describe.skipIf(!url)("checkout status and billing overview", () => {
  let client: DbClient;
  let userId: string;
  const provider = createFakeBillingProvider();

  const session = (planId: string): FakeCheckoutSession => ({
    checkoutId: `chk_fake_${randomUUID()}`,
    userId,
    planId,
    successUrl: "http://localhost/billing/success",
  });

  const status = (ref: { subscriptionId?: string; orderId?: string }) =>
    getCheckoutStatus({ db: client.db, userId, ...ref });

  const overview = () => getBillingOverview({ db: client.db, userId });

  beforeAll(() => {
    client = createDbClient(url!);
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    userId = randomUUID();
    await client.db.insert(user).values({
      id: userId,
      name: "Flow Test",
      email: `flow-${userId}@example.com`,
      emailVerified: true,
    });
  });

  afterEach(async () => {
    await client.db.delete(user).where(eq(user.id, userId));
  });

  test("subscription: pending before the webhook, complete after the first charge is processed, with credits granted", async () => {
    const payment = fakePayment(provider, session("pro"))!;
    const subscriptionId = payment.returnParams.subscription_id;
    expect(payment.events.map((e) => e.type)).toEqual([
      "subscription.active",
      "subscription.renewed",
      "checkout.completed",
    ]);

    await expect(status({ subscriptionId })).resolves.toEqual({
      status: "pending",
    });

    // Only subscription.active has arrived: the subscription exists but the first charge isn't
    // recorded yet, so still pending.
    await handleBillingEvent(payment.events[0]!, { db: client.db });
    await expect(status({ subscriptionId })).resolves.toEqual({
      status: "pending",
    });

    for (const event of payment.events.slice(1)) {
      await handleBillingEvent(event, { db: client.db });
    }
    await expect(status({ subscriptionId })).resolves.toEqual({
      status: "complete",
      planId: "pro",
    });

    const grants = await client.db
      .select({ amount: creditTransactions.amount })
      .from(creditTransactions)
      .where(eq(creditTransactions.userId, userId));
    expect(grants).toEqual([{ amount: 2000 }]);

    const current = await overview();
    expect(current).toMatchObject({
      subscription: { planId: "pro", status: "active" },
      purchasedPlanIds: [],
      hasCustomer: true,
    });
    expect(ownedPlans(current)).toEqual({ pro: "subscribed" });
  });

  test("one-time purchase: complete once the order is paid, and shown as purchased in the billing overview", async () => {
    const payment = fakePayment(provider, session("lifetime"))!;
    const orderId = payment.returnParams.order_id;
    await expect(status({ orderId })).resolves.toEqual({ status: "pending" });

    await handleBillingEvent(payment.events[0]!, { db: client.db });
    await expect(status({ orderId })).resolves.toEqual({
      status: "complete",
      planId: "lifetime",
    });
    const current = await overview();
    expect(current).toMatchObject({
      subscription: null,
      purchasedPlanIds: ["lifetime"],
    });
    expect(ownedPlans(current)).toEqual({ lifetime: "purchased" });
  });

  test("redirect without an order ID (Waffo Pancake, Stripe): located by plan + checkout time; only later orders of your own count", async () => {
    const since = new Date();
    const byPlan = (planId: string, at = since, uid = userId) =>
      getCheckoutStatus({ db: client.db, userId: uid, planId, since: at });

    await expect(byPlan("lifetime")).resolves.toEqual({ status: "pending" });

    const payment = fakePayment(provider, session("lifetime"))!;
    await handleBillingEvent(payment.events[0]!, { db: client.db });
    await expect(byPlan("lifetime")).resolves.toEqual({
      status: "complete",
      planId: "lifetime",
    });
    // Other plans, other users, and queries started long after checkout don't count as this payment.
    await expect(byPlan("pro")).resolves.toEqual({ status: "pending" });
    await expect(byPlan("lifetime", since, "someone-else")).resolves.toEqual({
      status: "pending",
    });
    await expect(
      byPlan("lifetime", new Date(Date.now() + 10 * 60 * 1000)),
    ).resolves.toEqual({ status: "pending" });
  });

  test("failed charge: returns failed when the subscription goes past_due", async () => {
    const payment = fakePayment(provider, session("pro"))!;
    const subscriptionId = payment.returnParams.subscription_id;
    await handleBillingEvent(payment.events[0]!, { db: client.db });
    await handleBillingEvent(
      provider.event("payment.failed", {
        userId,
        subscriptionId,
        occurredAt: new Date(Date.now() + 1000),
      }),
      { db: client.db },
    );
    await expect(status({ subscriptionId })).resolves.toEqual({
      status: "failed",
      planId: "pro",
    });
  });

  test("you can only see your own payments: other users' subscriptions and orders are always pending", async () => {
    const payment = fakePayment(provider, session("pro"))!;
    for (const event of payment.events) {
      await handleBillingEvent(event, { db: client.db });
    }
    await expect(
      getCheckoutStatus({
        db: client.db,
        userId: "someone-else",
        subscriptionId: payment.returnParams.subscription_id,
      }),
    ).resolves.toEqual({ status: "pending" });
  });

  test("with no payments at all: free plan, no customer record", async () => {
    await expect(overview()).resolves.toEqual({
      subscription: null,
      purchasedPlanIds: [],
      hasCustomer: false,
    });
  });
});
