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

// CI 必须提供测试库，不允许静默跳过。
if (!url && process.env.CI) {
  throw new Error("DATABASE_URL_TEST must be set in CI");
}
if (!url) {
  console.warn("跳过退款回收测试：未设置 DATABASE_URL_TEST（见 .env.example）");
}

// site.config.ts 的套餐：lifetime 一次发放 2000 积分。
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

  test("全额退款：回收全部发放的积分", () => {
    expect(call({ refundedAmount: ORDER_AMOUNT })).toMatchObject({
      amount: GRANTED,
      sourceId: reclaimSourceId("creem", "ord_1", "ref_1"),
    });
  });

  test("部分退款：按已退金额比例回收", () => {
    expect(call({ refundedAmount: ORDER_AMOUNT / 2 })?.amount).toBe(
      GRANTED / 2,
    );
    expect(call({ refundedAmount: ORDER_AMOUNT / 4 })?.amount).toBe(
      GRANTED / 4,
    );
  });

  test("累计口径：多次部分退款的取整误差由最后一次补上", () => {
    // 3000 分三次各退 1000，逐次取整会得到 666、666、666（少收 2），累计口径是 666、667、667。
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

  test("已经回收够了的订单不再回收", () => {
    expect(
      call({ refundedAmount: ORDER_AMOUNT, alreadyReclaimed: GRANTED }),
    ).toBeNull();
    expect(
      call({ refundedAmount: 1000, alreadyReclaimed: GRANTED }),
    ).toBeNull();
  });

  test("订单金额缺失或为 0 时不回收（退款先于付款事件到达）", () => {
    expect(call({ refundedAmount: 500, amount: null })).toBeNull();
    expect(call({ refundedAmount: 500, amount: 0 })).toBeNull();
  });

  test("已退金额超过订单金额时按订单金额封顶", () => {
    expect(call({ refundedAmount: ORDER_AMOUNT * 2 })?.amount).toBe(GRANTED);
  });

  test("部分退款的理由写明是部分退款", () => {
    expect(call({ refundedAmount: 1000 })?.reason).toContain("Partial");
    expect(call({ refundedAmount: ORDER_AMOUNT })?.reason).not.toContain(
      "Partial",
    );
  });
});

describe.skipIf(!url)("退款回收集分", () => {
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

  /** 走一遍真实流程：一次性购买发放积分，订单落库。 */
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
    // 测试自己保证表结构是最新的，不依赖外部先执行 db:migrate。
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

  test("全额退款：购买发放的积分全部回收，余额清零", async () => {
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
    "退款先到，%s 付款后到仍回收；重推不会重复回收",
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

  test("套餐下线后按实际发放额回收，不依赖当前套餐配置", async () => {
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

  test("订阅跨账期且套餐下线：只回收被退款订单对应的实际积分", async () => {
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

  test("旧 Creem 订单没有关联字段时，从付款原文恢复旧账期，套餐下线不影响", async () => {
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

  test("部分退款先到，后续多个退款按累计金额回收且不超过实际发放", async () => {
    const orderId = randomUUID();
    await handle(refund(orderId, { amount: 1000 }));
    await purchase({ orderId });
    expect(await balance()).toBe(GRANTED - 666);
    await handle(refund(orderId, { amount: 1000 }));
    expect(await balance()).toBe(GRANTED - 1333);
    await handle(refund(orderId, { amount: 1000 }));
    expect(await balance()).toBe(0);
  });

  test("付款与退款并发最终回收一次", async () => {
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

  test("补偿失败回滚整次付款，重试可以完成发放与回收", async () => {
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

  test("积分已经花掉一部分：扣到 0，差额不写流水（amount 有非零约束）", async () => {
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
    // 应回收 2000，余额只有 500 —— 只扣得动 500。
    expect(reclaim).toMatchObject({ amount: -500 });
  });

  test("余额为 0 时一分都扣不动，也不写流水", async () => {
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

  test("部分退款：按比例回收", async () => {
    const orderId = await purchase();
    await handle(refund(orderId, { amount: ORDER_AMOUNT / 4 }));

    expect(await balance()).toBe(GRANTED - GRANTED / 4);
  });

  test("多次部分退款的取整误差被最后一次补上", async () => {
    const orderId = await purchase();
    for (let i = 0; i < 3; i++) {
      await handle(refund(orderId, { amount: ORDER_AMOUNT / 3 }));
    }

    expect(await balance()).toBe(0);
  });

  test("重复推送同一个事件：不重复扣减", async () => {
    const orderId = await purchase();
    const event = refund(orderId);

    expect(await handle(event)).toMatchObject({ status: "processed" });
    const after = await balance();
    expect(await handle(event)).toEqual({ status: "duplicate" });
    expect(await balance()).toBe(after);
  });

  test("同一笔退款换事件 ID 重推：流水来源相同，同样不重复扣减", async () => {
    const orderId = await purchase();
    const refundId = `ref_${randomUUID()}`;

    await handle(refund(orderId, { refundId }));
    const after = await balance();
    // 服务商重试时换了事件 ID，(provider, event_id) 挡不住，由流水的
    // (source, sourceId) 兜住 —— 回收额度按已回收部分扣减后归零，不再写第二条。
    await handle(refund(orderId, { refundId, eventId: `evt_${randomUUID()}` }));

    expect(await balance()).toBe(after);
    const reclaimEntries = (await reclaims()).filter(
      (tx) => tx.source === REFUND_RECLAIM_SOURCE,
    );
    expect(reclaimEntries).toHaveLength(1);
  });

  test("features.credits 关闭时既不发放也不回收", async () => {
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

  test("套餐没有积分时不回收", async () => {
    const orderId = await purchase({ planId: "free" });
    // free 套餐有积分，先验证能回收；再用一个未知套餐验证不回收。
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
