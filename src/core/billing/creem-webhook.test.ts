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
import { processWebhook } from "./webhook";

const url = process.env.DATABASE_URL_TEST;
if (!url && process.env.CI) {
  throw new Error("DATABASE_URL_TEST must be set in CI");
}
if (!url) {
  console.warn("跳过 Creem webhook 测试：未设置 DATABASE_URL_TEST");
}

// 测试里要逐层修改官方示例 payload 的字段，用宽松类型。
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

describe.skipIf(!url)("Creem webhook → 账单表和积分", () => {
  let client: DbClient;
  let db: DbClient["db"];
  let userId: string;
  // 每个测试独立的 ID，避免 (provider, event_id) 等唯一约束互相影响。
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
    registerOnBillingEvent(
      "billing:grant-credits",
      createGrantCreditsHandler({
        enabled,
        grantCredits: createCredits({ db, enabled: true }).grantCredits,
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

  test("一次性购买：订单为 paid，积分到账一次；重复推送没有副作用", async () => {
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

  test("订阅：结账、激活、首期付款只发一次积分；下个账期再发一次", async () => {
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
    // 订阅结账不记订单；首期付款按交易记一笔。
    const paid = await db
      .select({ id: orders.providerOrderId, status: orders.status })
      .from(orders)
      .where(eq(orders.userId, userId));
    expect(paid).toEqual([{ id: ids.tran1, status: "paid" }]);
    expect(await balance()).toBe(2000);

    // 同一账期的付款事件再推一次（新的事件 ID）：积分不重复。
    const replay = subscriptionEvent("subscription.paid", {
      periodStart: period1,
      transaction: ids.tran1,
    });
    expect((await send(replay)).status).toBe(200);
    expect(await balance()).toBe(2000);

    // 续费：新账期、新交易。
    const renewal = subscriptionEvent("subscription.paid", {
      periodStart: period2,
      transaction: ids.tran2,
      createdAt: Date.parse(period2),
    });
    expect((await send(renewal)).status).toBe(200);
    expect(await balance()).toBe(4000);
  });

  test("乱序：续费先于结账到达时照样发积分", async () => {
    const paid = subscriptionEvent("subscription.paid", {
      periodStart: "2026-02-01T00:00:00.000Z",
      transaction: ids.tran1,
    });
    // metadata 里有 userId，不依赖结账事件先到。
    expect((await send(paid)).status).toBe(200);
    expect((await send(checkoutCompleted("subscription"))).status).toBe(200);
    expect(await balance()).toBe(2000);
  });

  test("签名错误返回 401，不写库", async () => {
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

  test("features.credits 关闭时不发积分，订单照常更新", async () => {
    useCredits(false);
    expect((await send(checkoutCompleted("one_time"))).status).toBe(200);
    const [order] = await db
      .select({ status: orders.status })
      .from(orders)
      .where(eq(orders.providerOrderId, ids.ord));
    expect(order.status).toBe("paid");
    expect(await balance()).toBe(0);
  });

  test("退款：订单变为 refunded，积分不扣回（v1）", async () => {
    await send(checkoutCompleted("one_time"));
    const refund = creemSample("refund.created");
    refund.id = eventId();
    const object = refund.object as Payload;
    object.id = `ref_${randomUUID()}`;
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
    expect(order).toEqual({ status: "refunded", refunded: 1210 });
    expect(await balance()).toBe(2000);
  });

  test("取消订阅：状态为 canceled，保留可用到的时间", async () => {
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
    expect(sub.status).toBe("canceled");
    expect(sub.currentPeriodEnd).toBeInstanceOf(Date);
  });
});
