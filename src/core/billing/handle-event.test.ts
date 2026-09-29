// @vitest-environment node
import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
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
  webhookEvents,
} from "@/core/db/schema";

import type { BillingEvent } from "./events";
import { handleBillingEvent, UnresolvedBillingUserError } from "./handle-event";
import {
  OnBillingEventError,
  registerOnBillingEvent,
  resetOnBillingEvent,
} from "./on-billing-event";
import { FakeProvider } from "./testing/fake-provider";
import { processWebhook } from "./webhook";

const url = process.env.DATABASE_URL_TEST;

// CI must provide a test database; silently skipping is not allowed.
if (!url && process.env.CI) {
  throw new Error("DATABASE_URL_TEST must be set in CI");
}
if (!url) {
  console.warn(
    "Skipping billing tests: DATABASE_URL_TEST is not set (see .env.example)",
  );
}

const t = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 0, minutes));

describe.skipIf(!url)("handleBillingEvent", () => {
  let client: DbClient;
  let db: DbClient["db"];
  // Each test uses its own provider IDs and user, so they don't interfere.
  let fake: FakeProvider;
  let userId: string;

  const handle = (event: BillingEvent) => handleBillingEvent(event, { db });

  beforeAll(() => {
    client = createDbClient(url!);
    db = client.db;
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    fake = new FakeProvider("secret", `fake-${randomUUID().slice(0, 8)}`);
    userId = randomUUID();
    await db.insert(user).values({
      id: userId,
      name: "Billing Test",
      email: `billing-${userId}@example.com`,
    });
  });

  afterEach(async () => {
    resetOnBillingEvent();
    vi.restoreAllMocks();
    await db.delete(user).where(eq(user.id, userId));
    await db.delete(webhookEvents).where(eq(webhookEvents.provider, fake.id));
  });

  const subscription = async (id: string) => {
    const [row] = await db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.provider, fake.id),
          eq(subscriptions.providerSubscriptionId, id),
        ),
      );
    return row;
  };

  const order = async (id: string) => {
    const [row] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.provider, fake.id), eq(orders.providerOrderId, id)));
    return row;
  };

  const recorded = (eventId: string) =>
    db
      .select()
      .from(webhookEvents)
      .where(
        and(
          eq(webhookEvents.provider, fake.id),
          eq(webhookEvents.eventId, eventId),
        ),
      );

  describe("every event type updates a subscription or order", () => {
    test("checkout.completed: records the order as paid and remembers the customer ID", async () => {
      await handle(
        fake.event("checkout.completed", {
          userId,
          customerId: "cus_1",
          checkoutId: "chk_1",
          orderId: "ord_1",
          planId: "lifetime",
          amount: 19900,
          currency: "USD",
        }),
      );

      expect(await order("ord_1"))!.toMatchObject({
        userId,
        status: "paid",
        amount: 19900,
        currency: "USD",
        planId: "lifetime",
      });
      const [customer] = await db
        .select()
        .from(billingCustomers)
        .where(eq(billingCustomers.provider, fake.id));
      expect(customer).toMatchObject({ userId, providerCustomerId: "cus_1" });
    });

    test("subscription.active: creates an active subscription", async () => {
      await handle(
        fake.event("subscription.active", {
          userId,
          subscriptionId: "sub_1",
          planId: "pro",
          currentPeriodStart: t(0),
          currentPeriodEnd: t(100),
        }),
      );

      expect(await subscription("sub_1"))!.toMatchObject({
        userId,
        status: "active",
        planId: "pro",
        currentPeriodStart: t(0),
        currentPeriodEnd: t(100),
      });
    });

    test("subscription.renewed: extends the period and records the renewal order", async () => {
      await handle(
        fake.event("subscription.active", {
          userId,
          subscriptionId: "sub_1",
          planId: "pro",
          currentPeriodEnd: t(100),
          occurredAt: t(0),
        }),
      );
      await handle(
        fake.event("subscription.renewed", {
          userId,
          subscriptionId: "sub_1",
          orderId: "ord_renew",
          amount: 1900,
          currency: "USD",
          currentPeriodStart: t(100),
          currentPeriodEnd: t(200),
          occurredAt: t(100),
        }),
      );

      expect(await subscription("sub_1"))!.toMatchObject({
        status: "active",
        planId: "pro",
        currentPeriodEnd: t(200),
      });
      expect(await order("ord_renew")).toMatchObject({
        status: "paid",
        amount: 1900,
        providerSubscriptionId: "sub_1",
      });
    });

    test("subscription.canceled: marks canceled and keeps the end time", async () => {
      await handle(
        fake.event("subscription.active", {
          userId,
          subscriptionId: "sub_1",
          currentPeriodEnd: t(100),
          occurredAt: t(0),
        }),
      );
      await handle(
        fake.event("subscription.canceled", {
          userId,
          subscriptionId: "sub_1",
          occurredAt: t(10),
        }),
      );

      expect(await subscription("sub_1"))!.toMatchObject({
        status: "canceled",
        canceledAt: t(10),
        currentPeriodEnd: t(100),
      });
    });

    test("subscription.expired: the subscription ends", async () => {
      await handle(
        fake.event("subscription.active", {
          userId,
          subscriptionId: "sub_1",
          occurredAt: t(0),
        }),
      );
      await handle(
        fake.event("subscription.expired", {
          userId,
          subscriptionId: "sub_1",
          occurredAt: t(100),
        }),
      );

      expect(await subscription("sub_1"))!.toMatchObject({
        status: "expired",
        endedAt: t(100),
      });
    });

    test("payment.failed: the subscription becomes past due and the order is marked failed", async () => {
      await handle(
        fake.event("subscription.active", {
          userId,
          subscriptionId: "sub_1",
          occurredAt: t(0),
        }),
      );
      await handle(
        fake.event("payment.failed", {
          userId,
          subscriptionId: "sub_1",
          orderId: "ord_fail",
          amount: 1900,
          currency: "USD",
          occurredAt: t(100),
        }),
      );

      expect((await subscription("sub_1"))!.status).toBe("past_due");
      expect((await order("ord_fail"))!.status).toBe("failed");
    });

    test("refund.created: partial and full refunds", async () => {
      await handle(
        fake.event("checkout.completed", {
          userId,
          checkoutId: "chk_1",
          orderId: "ord_1",
          amount: 19900,
          currency: "USD",
        }),
      );

      await handle(
        fake.event("refund.created", {
          userId,
          orderId: "ord_1",
          refundId: "re_1",
          amount: 5000,
          currency: "USD",
        }),
      );
      expect(await order("ord_1"))!.toMatchObject({
        status: "partially_refunded",
        refundedAmount: 5000,
      });

      await handle(
        fake.event("refund.created", {
          userId,
          orderId: "ord_1",
          refundId: "re_2",
          amount: 14900,
          currency: "USD",
        }),
      );
      expect(await order("ord_1"))!.toMatchObject({
        status: "refunded",
        refundedAmount: 19900,
      });
    });
  });

  describe("idempotency", () => {
    test("handling the same event twice gives the same result as once, and hooks fire only once", async () => {
      const hook = vi.fn();
      registerOnBillingEvent("test", hook);
      const event = fake.event("refund.created", {
        userId,
        orderId: "ord_1",
        refundId: "re_1",
        amount: 500,
        currency: "USD",
      });

      expect(await handle(event)).toMatchObject({ status: "processed" });
      const once = await order("ord_1");
      expect(await handle(event)).toEqual({ status: "duplicate" });

      expect(await order("ord_1"))!.toMatchObject({
        refundedAmount: once!.refundedAmount,
        status: once!.status,
      });
      expect(hook).toHaveBeenCalledTimes(1);
      expect(await recorded(event.eventId)).toHaveLength(1);
    });

    test("the same event arriving concurrently is handled only once", async () => {
      const hook = vi.fn();
      registerOnBillingEvent("test", hook);
      const event = fake.event("refund.created", {
        userId,
        orderId: "ord_1",
        refundId: "re_1",
        amount: 500,
        currency: "USD",
      });

      const results = await Promise.all(
        Array.from({ length: 5 }, () => handle(event)),
      );

      expect(results.filter((r) => r.status === "processed")).toHaveLength(1);
      expect((await order("ord_1"))!.refundedAmount).toBe(500);
      expect(hook).toHaveBeenCalledTimes(1);
    });
  });

  describe("out of order", () => {
    test("renewed arriving before active: still active in the end, with the period from the newer event", async () => {
      await handle(
        fake.event("subscription.renewed", {
          userId,
          subscriptionId: "sub_1",
          currentPeriodStart: t(100),
          currentPeriodEnd: t(200),
          occurredAt: t(100),
        }),
      );
      const active = fake.event("subscription.active", {
        userId,
        subscriptionId: "sub_1",
        planId: "pro",
        currentPeriodStart: t(0),
        currentPeriodEnd: t(100),
        occurredAt: t(0),
      });

      expect(await handle(active)).toMatchObject({ stale: true });
      expect(await subscription("sub_1"))!.toMatchObject({
        status: "active",
        currentPeriodEnd: t(200),
        // The old event still fills in the missing plan.
        planId: "pro",
      });
      const [row] = await recorded(active.eventId);
      expect(row!.stale).toBe(true);
    });

    test("an old renewed arriving after canceled doesn't revive the subscription", async () => {
      await handle(
        fake.event("subscription.active", {
          userId,
          subscriptionId: "sub_1",
          occurredAt: t(0),
        }),
      );
      await handle(
        fake.event("subscription.canceled", {
          userId,
          subscriptionId: "sub_1",
          occurredAt: t(150),
        }),
      );
      const hook = vi.fn();
      registerOnBillingEvent("test", hook);

      const result = await handle(
        fake.event("subscription.renewed", {
          userId,
          subscriptionId: "sub_1",
          currentPeriodEnd: t(200),
          occurredAt: t(100),
        }),
      );

      expect(result).toMatchObject({ status: "processed", stale: true });
      expect((await subscription("sub_1"))!.status).toBe("canceled");
      // The late renewal really happened, so hooks still fire and know it's an old event.
      expect(hook).toHaveBeenCalledWith(
        expect.objectContaining({ type: "subscription.renewed" }),
        expect.objectContaining({ stale: true, userId }),
      );
    });

    test("an old active arriving after expired doesn't revive the subscription", async () => {
      await handle(
        fake.event("subscription.expired", {
          userId,
          subscriptionId: "sub_1",
          occurredAt: t(300),
        }),
      );
      await handle(
        fake.event("subscription.active", {
          userId,
          subscriptionId: "sub_1",
          occurredAt: t(0),
        }),
      );

      expect((await subscription("sub_1"))!.status).toBe("expired");
    });

    test("refund arriving before checkout: correct status once the order amount is filled in", async () => {
      await handle(
        fake.event("refund.created", {
          userId,
          orderId: "ord_1",
          refundId: "re_1",
          amount: 5000,
          currency: "USD",
        }),
      );
      expect((await order("ord_1"))!.status).toBe("refunded");

      await handle(
        fake.event("checkout.completed", {
          userId,
          checkoutId: "chk_1",
          orderId: "ord_1",
          amount: 19900,
          currency: "USD",
        }),
      );
      expect(await order("ord_1"))!.toMatchObject({
        status: "partially_refunded",
        amount: 19900,
        refundedAmount: 5000,
      });
    });

    test("a payment failure arriving after success doesn't turn a paid order back to failed", async () => {
      await handle(
        fake.event("checkout.completed", {
          userId,
          checkoutId: "chk_1",
          orderId: "ord_1",
        }),
      );
      await handle(fake.event("payment.failed", { userId, orderId: "ord_1" }));

      expect((await order("ord_1"))!.status).toBe("paid");
    });
  });

  describe("finding the user", () => {
    test("an event with only a customer ID finds the user via the mapping remembered at checkout", async () => {
      await handle(
        fake.event("checkout.completed", {
          userId,
          customerId: "cus_1",
          checkoutId: "chk_1",
        }),
      );

      const result = await handle(
        fake.event("subscription.active", {
          customerId: "cus_1",
          subscriptionId: "sub_1",
        }),
      );

      expect(result).toMatchObject({ status: "processed", userId });
    });

    test("throws and rolls back when the user can't be found yet; a retry works once the mapping exists", async () => {
      const event = fake.event("subscription.active", {
        customerId: "cus_later",
        subscriptionId: "sub_1",
      });

      await expect(handle(event)).rejects.toBeInstanceOf(
        UnresolvedBillingUserError,
      );
      expect(await recorded(event.eventId)).toHaveLength(0);

      await handle(
        fake.event("checkout.completed", {
          userId,
          customerId: "cus_later",
          checkoutId: "chk_1",
        }),
      );
      expect(await handle(event)).toMatchObject({ status: "processed" });
    });

    test("when the user was deleted, the event is recorded but not handled, and not retried", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const hook = vi.fn();
      registerOnBillingEvent("test", hook);
      const event = fake.event("subscription.expired", {
        userId: randomUUID(),
        subscriptionId: "sub_gone",
      });

      expect(await handle(event)).toEqual({
        status: "ignored",
        reason: "unknown_user",
      });
      expect(await recorded(event.eventId)).toHaveLength(1);
      expect(hook).not.toHaveBeenCalled();
    });
  });

  describe("hooks", () => {
    test("hooks share the same transaction: when a later hook fails, earlier hooks' writes roll back too", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      registerOnBillingEvent("writes", async (_event, { tx }) => {
        await tx.insert(billingCustomers).values({
          userId,
          provider: fake.id,
          providerCustomerId: "cus_from_hook",
        });
      });
      registerOnBillingEvent("fails", () => {
        throw new Error("boom");
      });
      const event = fake.event("subscription.active", {
        userId,
        subscriptionId: "sub_1",
      });

      await expect(handle(event)).rejects.toBeInstanceOf(OnBillingEventError);

      expect(await recorded(event.eventId)).toHaveLength(0);
      expect(await subscription("sub_1"))!.toBeUndefined();
      const customers = await db
        .select()
        .from(billingCustomers)
        .where(eq(billingCustomers.provider, fake.id));
      expect(customers).toHaveLength(0);

      // Once the hook is fixed, the provider retrying the same event is handled normally.
      resetOnBillingEvent();
      expect(await handle(event)).toMatchObject({ status: "processed" });
      expect((await subscription("sub_1"))!.status).toBe("active");
    });

    test("runs in registration order", async () => {
      const calls: string[] = [];
      registerOnBillingEvent("a", () => void calls.push("a"));
      registerOnBillingEvent("b", () => void calls.push("b"));

      await handle(
        fake.event("subscription.active", { userId, subscriptionId: "sub_1" }),
      );

      expect(calls).toEqual(["a", "b"]);
    });
  });

  describe("processWebhook", () => {
    test("valid signature: handles the event and returns 200", async () => {
      const event = fake.event("subscription.active", {
        userId,
        subscriptionId: "sub_1",
        currentPeriodEnd: t(100),
      });

      const response = await processWebhook(fake, fake.request(event), { db });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: "processed" });
      expect(await subscription("sub_1"))!.toMatchObject({
        status: "active",
        currentPeriodEnd: t(100),
      });
    });

    test("bad signature: returns 401 and writes nothing", async () => {
      const event = fake.event("subscription.active", {
        userId,
        subscriptionId: "sub_1",
      });

      const response = await processWebhook(
        fake,
        fake.request(event, { signature: "0".repeat(64) }),
        { db },
      );

      expect(response.status).toBe(401);
      expect(await recorded(event.eventId)).toHaveLength(0);
      expect(await subscription("sub_1"))!.toBeUndefined();
    });

    test("event types we don't care about: return 200 and ignore", async () => {
      const body = JSON.stringify({ hello: "world" });
      const request = new Request("https://example.test/webhook", {
        method: "POST",
        headers: { "x-fake-signature": fake.sign(body) },
        body,
      });

      const response = await processWebhook(fake, request, { db });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "ignored" });
    });

    test("handling failure: returns 500 so the provider retries", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      registerOnBillingEvent("fails", () => {
        throw new Error("boom");
      });
      const event = fake.event("subscription.active", {
        userId,
        subscriptionId: "sub_1",
      });

      const response = await processWebhook(fake, fake.request(event), { db });

      expect(response.status).toBe(500);
      expect(await recorded(event.eventId)).toHaveLength(0);
    });
  });
});
