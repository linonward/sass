// @vitest-environment node
import { createHmac, randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";

import { createCredits } from "@/core/credits/service";
import { createDbClient, type DbClient } from "@/core/db/client";
import {
  creditTransactions,
  orders,
  subscriptions,
  user,
  userCredits,
  webhookEvents,
} from "@/core/db/schema";

import { createGrantCreditsHandler } from "./grant-credits";
import {
  registerOnBillingEvent,
  resetOnBillingEvent,
} from "./on-billing-event";
import { creemSample } from "./providers/__fixtures__/creem-webhooks";
import { createCreemProvider, type CreemClient } from "./providers/creem";
import { createReclaimCreditsHandler } from "./reclaim-credits";
import { processWebhook } from "./webhook";

const url = process.env.DATABASE_URL_TEST;
if (!url && process.env.CI) {
  throw new Error("DATABASE_URL_TEST must be set in CI");
}
if (!url) {
  console.warn("Skipping Creem webhook tests: DATABASE_URL_TEST is not set");
}

// Tests modify fields of the official sample payload level by level, so use a loose type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Payload = Record<string, any>;

const SECRET = "whsec_webhook_test";
const creem = createCreemProvider({
  apiKey: "unused",
  webhookSecret: SECRET,
  mode: "test",
  client: {} as CreemClient,
});

const sign = (body: string) =>
  createHmac("sha256", SECRET).update(body).digest("hex");

function request(payload: unknown, signature?: string) {
  const body = JSON.stringify(payload);
  return new Request("https://example.test/api/webhooks/creem", {
    method: "POST",
    headers: { "creem-signature": signature ?? sign(body) },
    body,
  });
}

describe.skipIf(!url)("Creem webhook → billing tables and credits", () => {
  let client: DbClient;
  let db: DbClient["db"];
  let userId: string;
  // Unique IDs per test, so unique constraints like (provider, event_id) don't interfere with each
  // other.
  let ids: {
    sub: string;
    cust: string;
    ord: string;
    tran1: string;
    tran2: string;
  };

  const send = (payload: unknown, signature?: string) =>
    processWebhook(creem, request(payload, signature), { db });

  const useCredits = (enabled: boolean) => {
    resetOnBillingEvent();
    const credits = createCredits({ db, enabled: true });
    registerOnBillingEvent(
      "billing:grant-credits",
      createGrantCreditsHandler({
        enabled,
        grantCredits: credits.grantCredits,
      }),
    );
    registerOnBillingEvent(
      "billing:reclaim-credits",
      createReclaimCreditsHandler({
        enabled,
        reclaimCredits: credits.reclaimCredits,
      }),
    );
  };

  const eventId = () => `evt_${randomUUID()}`;
  const metadata = () => ({ userId, planId: "pro" });

  function checkoutCompleted(kind: "subscription" | "one_time") {
    const sample = creemSample("checkout.completed");
    sample.id = eventId();
    const object = sample.object as Payload;
    object.id = `ch_${randomUUID()}`;
    object.order.id = ids.ord;
    object.order.customer = ids.cust;
    object.customer.id = ids.cust;
    object.metadata =
      kind === "subscription" ? metadata() : { userId, planId: "lifetime" };
    if (kind === "subscription") object.subscription.id = ids.sub;
    else delete object.subscription;
    return sample;
  }

  function subscriptionEvent(
    type: "subscription.active" | "subscription.paid" | "subscription.canceled",
    {
      periodStart,
      transaction,
      createdAt,
    }: {
      periodStart?: string;
      transaction?: string;
      createdAt?: number;
    } = {},
  ) {
    const sample = creemSample(type);
    sample.id = eventId();
    if (createdAt) sample.created_at = createdAt;
    const object = sample.object as Payload;
    object.id = ids.sub;
    object.customer.id = ids.cust;
    object.metadata = metadata();
    if (periodStart) {
      object.current_period_start_date = periodStart;
      object.current_period_end_date = new Date(
        new Date(periodStart).getTime() + 30 * 86_400_000,
      ).toISOString();
    }
    if (transaction) object.last_transaction_id = transaction;
    return sample;
  }

  const balance = async () =>
    (
      await db
        .select({ balance: userCredits.balance })
        .from(userCredits)
        .where(eq(userCredits.userId, userId))
    )[0]?.balance ?? 0;

  beforeAll(() => {
    client = createDbClient(url!);
    db = client.db;
  });

  afterAll(async () => {
    resetOnBillingEvent();
    await client.close();
  });

  beforeEach(async () => {
    userId = randomUUID();
    const n = randomUUID().slice(0, 8);
    ids = {
      sub: `sub_${n}`,
      cust: `cust_${n}`,
      ord: `ord_${n}`,
      tran1: `tran_${n}_1`,
      tran2: `tran_${n}_2`,
    };
    await db.insert(user).values({
      id: userId,
      name: "Creem Test",
      email: `creem-${userId}@example.com`,
      emailVerified: true,
    });
    useCredits(true);
  });

  afterEach(async () => {
    await db.delete(user).where(eq(user.id, userId));
  });

  test("one-time purchase: order is paid, credits arrive once; repeated deliveries have no side effects", async () => {
    const payload = checkoutCompleted("one_time");

    const first = await send(payload);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ status: "processed" });

    const again = await send(payload);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ status: "duplicate" });

    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.providerOrderId, ids.ord));
    expect(order).toMatchObject({
      userId,
      provider: "creem",
      planId: "lifetime",
      status: "paid",
      amount: 1000,
      currency: "EUR",
    });
    expect(await balance()).toBe(2000);
    const grants = await db
      .select()
      .from(creditTransactions)
      .where(eq(creditTransactions.userId, userId));
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({
      source: "billing",
      sourceId: `creem:order:${ids.ord}`,
      amount: 2000,
    });
  });

  test("subscription: checkout, activation and first payment grant credits once; the next billing period grants again", async () => {
    const period1 = "2026-01-01T00:00:00.000Z";
    const period2 = "2026-01-31T00:00:00.000Z";

    for (const payload of [
      checkoutCompleted("subscription"),
      subscriptionEvent("subscription.active"),
      subscriptionEvent("subscription.paid", {
        periodStart: period1,
        transaction: ids.tran1,
      }),
    ]) {
      expect((await send(payload)).status).toBe(200);
    }

    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.providerSubscriptionId, ids.sub));
    expect(sub).toMatchObject({
      userId,
      status: "active",
      planId: "pro",
      providerCustomerId: ids.cust,
      currentPeriodStart: new Date(period1),
    });
    // Subscription checkout records no order; the first payment records one per transaction.
    const paid = await db
      .select({ id: orders.providerOrderId, status: orders.status })
      .from(orders)
      .where(eq(orders.userId, userId));
    expect(paid).toEqual([{ id: ids.tran1, status: "paid" }]);
    expect(await balance()).toBe(2000);

    // Push a payment event for the same period again (new event ID): no duplicate credits.
    const replay = subscriptionEvent("subscription.paid", {
      periodStart: period1,
      transaction: ids.tran1,
    });
    expect((await send(replay)).status).toBe(200);
    expect(await balance()).toBe(2000);

    // Renewal: new billing period, new transaction.
    const renewal = subscriptionEvent("subscription.paid", {
      periodStart: period2,
      transaction: ids.tran2,
      createdAt: Date.parse(period2),
    });
    expect((await send(renewal)).status).toBe(200);
    expect(await balance()).toBe(4000);
  });

  test("out of order: credits are still granted when the renewal arrives before checkout", async () => {
    const paid = subscriptionEvent("subscription.paid", {
      periodStart: "2026-02-01T00:00:00.000Z",
      transaction: ids.tran1,
    });
    // userId is in the metadata, so we don't depend on the checkout event arriving first.
    expect((await send(paid)).status).toBe(200);
    expect((await send(checkoutCompleted("subscription"))).status).toBe(200);
    expect(await balance()).toBe(2000);
  });

  test("a bad signature returns 401 and writes nothing", async () => {
    const payload = checkoutCompleted("one_time");
    const response = await send(payload, "0".repeat(64));
    expect(response.status).toBe(401);

    const events = await db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.eventId, payload.id));
    expect(events).toHaveLength(0);
    expect(await balance()).toBe(0);
  });

  test("with features.credits off, no credits are granted and orders still update", async () => {
    useCredits(false);
    expect((await send(checkoutCompleted("one_time"))).status).toBe(200);
    const [order] = await db
      .select({ status: orders.status })
      .from(orders)
      .where(eq(orders.providerOrderId, ids.ord));
    expect(order!.status).toBe("paid");
    expect(await balance()).toBe(0);
  });

  test("refund: order becomes partially_refunded and credits are reclaimed by the refunded share", async () => {
    await send(checkoutCompleted("one_time"));
    const refund = creemSample("refund.created");
    refund.id = eventId();
    const object = refund.object as Payload;
    object.id = `ref_${randomUUID()}`;
    // The order is 1000 (EUR, a one-time purchase granting 2000 credits); refunding half → reclaim half.
    object.refund_amount = 500;
    delete object.transaction.subscription;
    delete object.subscription;
    object.transaction.order = ids.ord;
    object.order.id = ids.ord;
    object.customer.id = ids.cust;
    object.checkout.metadata = { userId };
    expect((await send(refund)).status).toBe(200);

    const [order] = await db
      .select({ status: orders.status, refunded: orders.refundedAmount })
      .from(orders)
      .where(eq(orders.providerOrderId, ids.ord));
    expect(order).toEqual({ status: "partially_refunded", refunded: 500 });
    expect(await balance()).toBe(1000);
  });

  test("cancel subscription: status is canceled and the paid-through time is kept", async () => {
    await send(checkoutCompleted("subscription"));
    await send(
      subscriptionEvent("subscription.paid", {
        periodStart: "2026-03-01T00:00:00.000Z",
        transaction: ids.tran1,
        createdAt: Date.parse("2026-03-01T00:00:00.000Z"),
      }),
    );
    const canceled = subscriptionEvent("subscription.canceled", {
      createdAt: Date.parse("2026-03-05T00:00:00.000Z"),
    });
    expect((await send(canceled)).status).toBe(200);

    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.providerSubscriptionId, ids.sub));
    expect(sub!.status).toBe("canceled");
    expect(sub!.currentPeriodEnd).toBeInstanceOf(Date);
  });
});
