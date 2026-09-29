// @vitest-environment node
import { randomUUID } from "node:crypto";
import path from "node:path";

import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";

import { createCredits, type Credits } from "@/core/credits/service";
import { createDbClient, type DbClient } from "@/core/db/client";
import {
  creditTransactions,
  orders,
  user,
  webhookEvents,
} from "@/core/db/schema";

import type { BillingEvent } from "./events";
import { createGrantCreditsHandler } from "./grant-credits";
import { handleBillingEvent } from "./handle-event";
import {
  registerOnBillingEvent,
  resetOnBillingEvent,
} from "./on-billing-event";
import {
  REFUND_RECLAIM_SOURCE,
  createReclaimCreditsHandler,
  creditsToReclaim,
  reclaimSourceId,
} from "./reclaim-credits";
import { FakeProvider } from "./testing/fake-provider";

const url = process.env.DATABASE_URL_TEST;

// CI must provide a test database; silently skipping is not allowed.
if (!url && process.env.CI) {
  throw new Error("DATABASE_URL_TEST must be set in CI");
}
if (!url) {
  console.warn(
    "Skipping refund reclaim tests: DATABASE_URL_TEST is not set (see .env.example)",
  );
}

// Plans from site.config.ts: lifetime grants 2000 credits once.
const GRANTED = 2000;
const ORDER_AMOUNT = 3000;

const refundBase = {
  provider: "creem",
  eventId: "evt_1",
  occurredAt: new Date(),
  raw: null,
  orderId: "ord_1",
  refundId: "ref_1",
  amount: ORDER_AMOUNT,
  currency: "USD",
} as const;

describe("creditsToReclaim", () => {
  const event: BillingEvent & { type: "refund.created" } = {
    ...refundBase,
    type: "refund.created",
  };

  const call = (over: {
    refundedAmount: number;
    amount?: number | null;
    granted?: number;
    alreadyReclaimed?: number;
  }) =>
    creditsToReclaim({
      event,
      order: {
        amount: over.amount === undefined ? ORDER_AMOUNT : over.amount,
        refundedAmount: over.refundedAmount,
      },
      granted: over.granted ?? GRANTED,
      alreadyReclaimed: over.alreadyReclaimed ?? 0,
    });

  test("full refund: reclaims all granted credits", () => {
    expect(call({ refundedAmount: ORDER_AMOUNT })).toMatchObject({
      amount: GRANTED,
      sourceId: reclaimSourceId("creem", "ord_1", "ref_1"),
    });
  });

  test("partial refund: reclaims in proportion to the refunded amount", () => {
    expect(call({ refundedAmount: ORDER_AMOUNT / 2 })?.amount).toBe(
      GRANTED / 2,
    );
    expect(call({ refundedAmount: ORDER_AMOUNT / 4 })?.amount).toBe(
      GRANTED / 4,
    );
  });

  test("cumulative basis: rounding error from several partial refunds is made up by the last one", () => {
    // 3000 refunded as 1000 three times: rounding each gives 666, 666, 666 (2 short); cumulative
    // gives 666, 667, 667.
    const first = call({ refundedAmount: 1000 })!;
    const second = call({
      refundedAmount: 2000,
      alreadyReclaimed: first.amount,
    })!;
    const third = call({
      refundedAmount: 3000,
      alreadyReclaimed: first.amount + second.amount,
    })!;
    expect([first.amount, second.amount, third.amount]).toEqual([
      666, 667, 667,
    ]);
    expect(first.amount + second.amount + third.amount).toBe(GRANTED);
  });

  test("an order that has already been fully reclaimed isn't reclaimed again", () => {
    expect(
      call({ refundedAmount: ORDER_AMOUNT, alreadyReclaimed: GRANTED }),
    ).toBeNull();
    expect(
      call({ refundedAmount: 1000, alreadyReclaimed: GRANTED }),
    ).toBeNull();
  });

  test("no reclaim when the order amount is missing or 0 (refund arrived before the payment event)", () => {
    expect(call({ refundedAmount: 500, amount: null })).toBeNull();
    expect(call({ refundedAmount: 500, amount: 0 })).toBeNull();
  });

  test("a refunded amount above the order amount is capped at the order amount", () => {
    expect(call({ refundedAmount: ORDER_AMOUNT * 2 })?.amount).toBe(GRANTED);
  });

  test("the reason for a partial refund says it is a partial refund", () => {
    expect(call({ refundedAmount: 1000 })?.reason).toContain("Partial");
    expect(call({ refundedAmount: ORDER_AMOUNT })?.reason).not.toContain(
      "Partial",
    );
  });
});

describe.skipIf(!url)("refund credit reclaim", () => {
  let client: DbClient;
  let db: DbClient["db"];
  let credits: Credits;
  let fake: FakeProvider;
  let userId: string;

  const handle = (event: BillingEvent) => handleBillingEvent(event, { db });

  const balance = async (id = userId) => credits.getBalance(id);

  const reclaims = (id = userId) =>
    db
      .select()
      .from(creditTransactions)
      .where(eq(creditTransactions.userId, id));

  function useCredits(enabled: boolean) {
    resetOnBillingEvent();
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
  }

  /** Run the real flow: a one-time purchase grants credits and the order is stored. */
  async function purchase({
    planId = "lifetime",
    orderId = `ord_${randomUUID()}`,
    amount = ORDER_AMOUNT,
  } = {}) {
    const event = fake.event("checkout.completed", {
      userId,
      checkoutId: `chk_${randomUUID()}`,
      orderId,
      planId,
      amount,
      currency: "USD",
    });
    expect(await handle(event)).toMatchObject({ status: "processed" });
    return orderId;
  }

  const refund = (
    orderId: string,
    {
      amount = ORDER_AMOUNT,
      refundId = `ref_${randomUUID()}`,
      eventId,
    }: { amount?: number; refundId?: string; eventId?: string } = {},
  ) =>
    fake.event("refund.created", {
      userId,
      orderId,
      refundId,
      amount,
      currency: "USD",
      ...(eventId ? { eventId } : {}),
    });

  beforeAll(async () => {
    // The test makes sure the schema is current itself instead of relying on db:migrate being run first.
    const pool = new Pool({ connectionString: url });
    await migrate(drizzle({ client: pool }), {
      migrationsFolder: path.resolve(__dirname, "../../../drizzle"),
    });
    await pool.end();

    client = createDbClient(url!);
    db = client.db;
    credits = createCredits({ db, enabled: true });
  });

  afterAll(async () => {
    resetOnBillingEvent();
    await client?.close();
  });

  beforeEach(async () => {
    fake = new FakeProvider("secret", `fake-${randomUUID().slice(0, 8)}`);
    userId = `reclaim-test-${randomUUID()}`;
    await db.insert(user).values({
      id: userId,
      name: "Reclaim Test",
      email: `${userId}@example.com`,
    });
    useCredits(true);
  });

  test("full refund: all credits granted by the purchase are reclaimed and the balance goes to zero", async () => {
    const orderId = await purchase();
    expect(await balance()).toBe(GRANTED);

    const result = await handle(refund(orderId));
    expect(result).toMatchObject({ status: "processed" });

    expect(await balance()).toBe(0);
    const entry = (await reclaims()).find(
      (tx) => tx.source === REFUND_RECLAIM_SOURCE,
    );
    expect(entry).toMatchObject({
      type: "deduct",
      amount: -GRANTED,
      source: REFUND_RECLAIM_SOURCE,
    });
    expect(entry!.reason).toContain(orderId);
  });

  test.each(["checkout", "subscription"])(
    "refund first, %s payment later: still reclaimed; re-pushes don't reclaim twice",
    async (kind) => {
      const orderId = `ord_${randomUUID()}`;
      await handle(refund(orderId));
      expect(await balance()).toBe(0);
      const paid =
        kind === "checkout"
          ? fake.event("checkout.completed", {
              userId,
              checkoutId: randomUUID(),
              orderId,
              planId: "lifetime",
              amount: ORDER_AMOUNT,
              currency: "USD",
            })
          : fake.event("subscription.renewed", {
              userId,
              subscriptionId: randomUUID(),
              orderId,
              planId: "pro",
              amount: ORDER_AMOUNT,
              currency: "USD",
              currentPeriodStart: new Date("2026-01-01T00:00:00Z"),
            });
      await handle(paid);
      expect(await balance()).toBe(0);
      expect(
        (await reclaims()).filter((tx) => tx.source === REFUND_RECLAIM_SOURCE),
      ).toHaveLength(1);
      expect(await handle(paid)).toEqual({ status: "duplicate" });
      await handle({ ...paid, eventId: randomUUID() });
      expect(await balance()).toBe(0);
    },
  );

  test("after a plan is retired, reclaims by the amount actually granted, not the current plan config", async () => {
    const orderId = await purchase({ planId: "removed-plan" });
    await credits.grantCredits({
      userId,
      amount: 777,
      source: "billing",
      sourceId: `${fake.id}:order:${orderId}`,
    });
    await handle(refund(orderId));
    expect(await balance()).toBe(0);
    expect(
      (await reclaims()).find((tx) => tx.source === REFUND_RECLAIM_SOURCE)
        ?.amount,
    ).toBe(-777);
  });

  test("subscription across billing periods with a retired plan: reclaims only the credits actually granted for the refunded order", async () => {
    const subscriptionId = randomUUID();
    const first = fake.event("subscription.renewed", {
      userId,
      subscriptionId,
      orderId: randomUUID(),
      planId: "pro",
      amount: ORDER_AMOUNT,
      currency: "USD",
      currentPeriodStart: new Date("2026-01-01T00:00:00Z"),
    });
    const second = {
      ...first,
      eventId: randomUUID(),
      orderId: randomUUID(),
      currentPeriodStart: new Date("2026-02-01T00:00:00Z"),
    };
    await handle(first);
    await handle(second);
    await db
      .update(orders)
      .set({ planId: "removed-plan" })
      .where(eq(orders.providerOrderId, first.orderId!));
    await handle(refund(first.orderId!));
    expect(await balance()).toBe(GRANTED);
    await handle(refund(second.orderId!));
    expect(await balance()).toBe(0);
  });

  test("old Creem orders without the link fields: recovers the old billing period from the raw payment; plan retirement doesn't matter", async () => {
    const orderId = randomUUID(),
      subscriptionId = randomUUID(),
      eventId = randomUUID();
    const period = new Date("2026-01-01T00:00:00Z");
    // Seed a pre-upgrade order and its actual grant, independent of current config.
    await db.insert(orders).values({
      userId,
      provider: "creem",
      providerOrderId: orderId,
      providerSubscriptionId: subscriptionId,
      planId: "removed-plan",
      amount: ORDER_AMOUNT,
      currency: "USD",
      status: "paid",
    });
    await credits.grantCredits({
      userId,
      amount: 777,
      source: "billing",
      sourceId: `creem:subscription:${subscriptionId}:${period.toISOString()}`,
    });
    await db.insert(webhookEvents).values({
      provider: "creem",
      eventId,
      type: "subscription.renewed",
      occurredAt: period,
      raw: {
        id: eventId,
        eventType: "subscription.paid",
        created_at: period.getTime(),
        object: {
          id: subscriptionId,
          last_transaction_id: orderId,
          current_period_start_date: period.toISOString(),
          metadata: { userId, planId: "removed-plan" },
        },
      },
    });
    await handle({ ...refund(orderId), provider: "creem" });
    expect(await balance()).toBe(0);
    expect(
      (await reclaims()).find((tx) => tx.source === REFUND_RECLAIM_SOURCE)
        ?.amount,
    ).toBe(-777);
  });

  test("partial refund first, then several refunds reclaim by cumulative amount without exceeding what was granted", async () => {
    const orderId = randomUUID();
    await handle(refund(orderId, { amount: 1000 }));
    await purchase({ orderId });
    expect(await balance()).toBe(GRANTED - 666);
    await handle(refund(orderId, { amount: 1000 }));
    expect(await balance()).toBe(GRANTED - 1333);
    await handle(refund(orderId, { amount: 1000 }));
    expect(await balance()).toBe(0);
  });

  test("concurrent payment and refund end up reclaiming once", async () => {
    const orderId = randomUUID();
    const paid = fake.event("checkout.completed", {
      userId,
      checkoutId: randomUUID(),
      orderId,
      planId: "lifetime",
      amount: ORDER_AMOUNT,
      currency: "USD",
    });
    await Promise.all([handle(paid), handle(refund(orderId))]);
    expect(await balance()).toBe(0);
    expect(
      (await reclaims()).filter((tx) => tx.source === REFUND_RECLAIM_SOURCE),
    ).toHaveLength(1);
  });

  test("a failed compensation rolls back the whole payment; a retry completes both grant and reclaim", async () => {
    const orderId = randomUUID();
    await handle(refund(orderId));
    registerOnBillingEvent(
      "billing:reclaim-credits",
      createReclaimCreditsHandler({
        enabled: true,
        reclaimCredits: async () => {
          throw new Error("transient reclaim failure");
        },
      }),
    );
    const paid = fake.event("checkout.completed", {
      userId,
      checkoutId: randomUUID(),
      orderId,
      planId: "lifetime",
      amount: ORDER_AMOUNT,
      currency: "USD",
    });
    await expect(handle(paid)).rejects.toThrow();
    expect(await balance()).toBe(0);
    expect(await reclaims()).toHaveLength(0);
    useCredits(true);
    expect(await handle(paid)).toMatchObject({ status: "processed" });
    expect(await balance()).toBe(0);
    expect(await reclaims()).toHaveLength(2);
  });

  test("credits partly spent already: deducts down to 0; the difference isn't written as a transaction (amount has a non-zero constraint)", async () => {
    const orderId = await purchase();
    await credits.deductCredits({
      userId,
      amount: 1500,
      source: "ai",
      sourceId: `call_${randomUUID()}`,
    });
    expect(await balance()).toBe(GRANTED - 1500);

    await handle(refund(orderId));

    expect(await balance()).toBe(0);
    const entries = await reclaims();
    const reclaim = entries.find((tx) => tx.source === REFUND_RECLAIM_SOURCE);
    // Should reclaim 2000 but the balance is only 500 — only 500 can be deducted.
    expect(reclaim).toMatchObject({ amount: -500 });
  });

  test("with a balance of 0 nothing can be deducted, and no transaction is written", async () => {
    const orderId = await purchase();
    await credits.deductCredits({
      userId,
      amount: GRANTED,
      source: "ai",
      sourceId: `call_${randomUUID()}`,
    });

    await handle(refund(orderId));

    expect(await balance()).toBe(0);
    expect(
      (await reclaims()).some((tx) => tx.source === REFUND_RECLAIM_SOURCE),
    ).toBe(false);
  });

  test("partial refund: reclaims proportionally", async () => {
    const orderId = await purchase();
    await handle(refund(orderId, { amount: ORDER_AMOUNT / 4 }));

    expect(await balance()).toBe(GRANTED - GRANTED / 4);
  });

  test("rounding error from several partial refunds is made up by the last one", async () => {
    const orderId = await purchase();
    for (let i = 0; i < 3; i++) {
      await handle(refund(orderId, { amount: ORDER_AMOUNT / 3 }));
    }

    expect(await balance()).toBe(0);
  });

  test("pushing the same event again: no duplicate deduction", async () => {
    const orderId = await purchase();
    const event = refund(orderId);

    expect(await handle(event)).toMatchObject({ status: "processed" });
    const after = await balance();
    expect(await handle(event)).toEqual({ status: "duplicate" });
    expect(await balance()).toBe(after);
  });

  test("the same refund re-pushed with a new event ID: same transaction source, still no duplicate deduction", async () => {
    const orderId = await purchase();
    const refundId = `ref_${randomUUID()}`;

    await handle(refund(orderId, { refundId }));
    const after = await balance();
    // The provider changed the event ID on retry, so (provider, event_id) can't catch it; the
    // transaction's (source, sourceId) does — the reclaim amount drops to zero after subtracting what
    // was already reclaimed, so no second transaction is written.
    await handle(refund(orderId, { refundId, eventId: `evt_${randomUUID()}` }));

    expect(await balance()).toBe(after);
    const reclaimEntries = (await reclaims()).filter(
      (tx) => tx.source === REFUND_RECLAIM_SOURCE,
    );
    expect(reclaimEntries).toHaveLength(1);
  });

  test("with features.credits off, credits are neither granted nor reclaimed", async () => {
    useCredits(false);
    const event = fake.event("checkout.completed", {
      userId,
      checkoutId: `chk_${randomUUID()}`,
      orderId: `ord_${randomUUID()}`,
      planId: "lifetime",
      amount: ORDER_AMOUNT,
      currency: "USD",
    });
    await handle(event);
    expect(await balance()).toBe(0);

    const orderId = event.orderId!;
    await db
      .update(orders)
      .set({ refundedAmount: ORDER_AMOUNT })
      .where(eq(orders.providerOrderId, orderId));
    await handle(refund(orderId));

    expect(await balance()).toBe(0);
    expect(await reclaims()).toHaveLength(0);
  });

  test("no reclaim when the plan has no credits", async () => {
    const orderId = await purchase({ planId: "free" });
    // The free plan has credits, so first check it can be reclaimed; then use an unknown plan to
    // check nothing is reclaimed.
    await handle(refund(orderId));
    expect(
      (await reclaims()).some((tx) => tx.source === REFUND_RECLAIM_SOURCE),
    ).toBe(true);

    const noCreditsUser = `reclaim-test-${randomUUID()}`;
    await db.insert(user).values({
      id: noCreditsUser,
      name: "No Credits",
      email: `${noCreditsUser}@example.com`,
    });
    const unknownOrder = `ord_${randomUUID()}`;
    await handle(
      fake.event("checkout.completed", {
        userId: noCreditsUser,
        checkoutId: `chk_${randomUUID()}`,
        orderId: unknownOrder,
        planId: "not-a-plan",
        amount: ORDER_AMOUNT,
        currency: "USD",
      }),
    );
    await handle(
      fake.event("refund.created", {
        userId: noCreditsUser,
        orderId: unknownOrder,
        refundId: `ref_${randomUUID()}`,
        amount: ORDER_AMOUNT,
        currency: "USD",
      }),
    );

    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(creditTransactions)
      .where(eq(creditTransactions.userId, noCreditsUser));
    expect(row!.count).toBe(0);
  });
});
