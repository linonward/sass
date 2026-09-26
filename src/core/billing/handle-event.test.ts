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

// CI 必须提供测试库，不允许静默跳过。
if (!url && process.env.CI) {
  throw new Error("DATABASE_URL_TEST must be set in CI");
}
if (!url) {
  console.warn("跳过账单测试：未设置 DATABASE_URL_TEST（见 .env.example）");
}

const t = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 0, minutes));

describe.skipIf(!url)("handleBillingEvent", () => {
  let client: DbClient;
  let db: DbClient["db"];
  // 每个测试用独立的服务商 ID 和用户，互不干扰。
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

  describe("每种事件都会更新订阅或订单", () => {
    test("checkout.completed：记录订单为已付款，并记住客户 ID", async () => {
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

    test("subscription.active：创建生效中的订阅", async () => {
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

    test("subscription.renewed：延长周期，并记录续费订单", async () => {
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

    test("subscription.canceled：标记取消，保留到期时间", async () => {
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

    test("subscription.expired：订阅结束", async () => {
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

    test("payment.failed：订阅变为逾期，订单记为失败", async () => {
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

    test("refund.created：部分退款和全额退款", async () => {
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

  describe("幂等", () => {
    test("同一事件处理两次，结果与一次相同，钩子只触发一次", async () => {
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

    test("同一事件并发到达，只处理一次", async () => {
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

  describe("乱序", () => {
    test("renewed 先于 active 到达：最终仍是生效中，周期取较新的事件", async () => {
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
        // 旧事件仍然补上缺失的套餐。
        planId: "pro",
      });
      const [row] = await recorded(active.eventId);
      expect(row!.stale).toBe(true);
    });

    test("canceled 之后才到的旧 renewed 不会让订阅恢复", async () => {
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
      // 迟到的续费是真实发生过的，钩子照常触发并知道它是旧事件。
      expect(hook).toHaveBeenCalledWith(
        expect.objectContaining({ type: "subscription.renewed" }),
        expect.objectContaining({ stale: true, userId }),
      );
    });

    test("expired 之后才到的旧 active 不会让订阅恢复", async () => {
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

    test("退款先于结账事件到达：订单金额补齐后得到正确的状态", async () => {
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

    test("付款失败晚于成功到达，不会把已付款的订单改回失败", async () => {
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

  describe("找用户", () => {
    test("只带客户 ID 的事件，按结账时记住的映射找到用户", async () => {
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

    test("暂时找不到用户时抛错并回滚，映射建立后重试即可处理", async () => {
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

    test("用户已删除时记录事件但不处理，也不再重试", async () => {
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

  describe("钩子", () => {
    test("钩子拿到同一个事务：后面的钩子失败时，前面钩子的写入也被回滚", async () => {
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

      // 修好钩子后，服务商重试同一事件即可正常处理。
      resetOnBillingEvent();
      expect(await handle(event)).toMatchObject({ status: "processed" });
      expect((await subscription("sub_1"))!.status).toBe("active");
    });

    test("按注册顺序执行", async () => {
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
    test("签名正确：处理事件并返回 200", async () => {
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

    test("签名错误：返回 401，不写库", async () => {
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

    test("不关心的事件类型：返回 200 并忽略", async () => {
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

    test("处理失败：返回 500，让服务商重试", async () => {
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
