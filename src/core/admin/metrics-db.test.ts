// @vitest-environment node
import { randomUUID } from "node:crypto";
import path from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import type { Plan } from "@/core/config/schema";
import type { Database } from "@/core/db/client";
import * as schema from "@/core/db/schema";
import {
  aiUsage,
  creditTransactions,
  orders,
  subscriptions,
  user,
} from "@/core/db/schema";

import {
  getAiMetrics,
  getCreditMetrics,
  getRevenueMetrics,
  getUserMetrics,
  metricWindow,
} from "./metrics";

const url = process.env.DATABASE_URL_TEST;

if (!url && process.env.CI) {
  throw new Error("DATABASE_URL_TEST must be set in CI");
}

// 指标是全表聚合，和其他用例共用一个库时数字不确定，所以建一个临时库，跑完删掉。
describe.skipIf(!url)("后台指标", () => {
  const dbName = `metrics_test_${randomUUID().replaceAll("-", "")}`;
  let admin: Pool;
  let pool: Pool;
  let db: Database;

  const now = new Date();
  const window = metricWindow(7, now);
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);
  const dayKey = (date: Date) => date.toISOString().slice(0, 10);

  const plans = [
    { id: "free", price: 0, interval: "month" },
    { id: "pro", price: 19, interval: "month" },
    { id: "yearly", price: 190, interval: "year" },
    { id: "lifetime", price: 99, interval: "once" },
  ] as Plan[];

  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`create database ${dbName}`);
    const testUrl = new URL(url!);
    testUrl.pathname = `/${dbName}`;
    pool = new Pool({ connectionString: testUrl.toString() });
    // 删库时服务端会断开残留的连接，不当作错误。
    pool.on("error", () => {});
    const nodeDb = drizzle({ client: pool, schema });
    db = nodeDb;
    await migrate(nodeDb, {
      migrationsFolder: path.resolve(__dirname, "../../../drizzle"),
    });
    await seed();
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`drop database if exists ${dbName} with (force)`);
    await admin?.end();
  });

  const ids = {
    recent: "u-recent",
    recent2: "u-recent2",
    old: "u-old",
    banned: "u-banned",
  };

  async function seed() {
    await db.insert(user).values([
      {
        id: ids.recent,
        name: "a",
        email: "a@example.com",
        createdAt: daysAgo(1),
      },
      {
        id: ids.recent2,
        name: "b",
        email: "b@example.com",
        createdAt: daysAgo(1),
      },
      {
        id: ids.old,
        name: "c",
        email: "c@example.com",
        createdAt: daysAgo(30),
      },
      {
        id: ids.banned,
        name: "d",
        email: "d@example.com",
        createdAt: daysAgo(3),
        banned: true,
      },
    ]);

    const order = (
      userId: string,
      values: Partial<typeof orders.$inferInsert>,
    ): typeof orders.$inferInsert => ({
      userId,
      provider: "fake",
      providerOrderId: randomUUID(),
      status: "paid",
      amount: 1900,
      currency: "USD",
      ...values,
    });
    await db.insert(orders).values([
      order(ids.recent, { createdAt: daysAgo(1) }),
      // 部分退款：净收入 1000。
      order(ids.recent2, {
        createdAt: daysAgo(2),
        status: "partially_refunded",
        amount: 1900,
        refundedAmount: 900,
      }),
      // 全额退款、失败、区间外的订单都不计入。
      order(ids.banned, {
        createdAt: daysAgo(2),
        status: "refunded",
        refundedAmount: 1900,
      }),
      order(ids.banned, { createdAt: daysAgo(2), status: "failed" }),
      order(ids.old, { createdAt: daysAgo(30) }),
      // 其他币种单独列出，不进每日图表。
      order(ids.old, { createdAt: daysAgo(1), amount: 500, currency: "eur" }),
    ]);

    const subscription = (
      planId: string | null,
      status: (typeof subscriptions.$inferInsert)["status"],
    ): typeof subscriptions.$inferInsert => ({
      userId: ids.recent,
      provider: "fake",
      providerSubscriptionId: randomUUID(),
      planId,
      status,
      lastEventAt: now,
    });
    await db
      .insert(subscriptions)
      .values([
        subscription("pro", "active"),
        subscription("pro", "active"),
        subscription("yearly", "active"),
        subscription("deleted-plan", "active"),
        subscription("pro", "canceled"),
        subscription("pro", "past_due"),
        subscription("pro", "expired"),
      ]);

    const tx = (
      type: "grant" | "deduct" | "refund" | "adjust",
      amount: number,
      createdAt = daysAgo(1),
    ): typeof creditTransactions.$inferInsert => ({
      userId: ids.recent,
      type,
      amount,
      source: "test",
      sourceId: randomUUID(),
      createdAt,
    });
    await db
      .insert(creditTransactions)
      .values([
        tx("grant", 100),
        tx("grant", 50),
        tx("deduct", -30),
        tx("deduct", -5),
        tx("refund", 5),
        tx("adjust", -10),
        tx("grant", 1000, daysAgo(30)),
      ]);

    const call = (
      kind: "text" | "image" | "video",
      modelId: string,
      status: "pending" | "succeeded" | "failed" | "aborted",
      createdAt = daysAgo(1),
    ): typeof aiUsage.$inferInsert => ({
      userId: ids.recent,
      kind,
      modelId,
      provider: "fake",
      model: modelId,
      credits: 1,
      status,
      createdAt,
    });
    await db
      .insert(aiUsage)
      .values([
        call("text", "fast", "succeeded"),
        call("text", "fast", "succeeded"),
        call("text", "fast", "failed"),
        call("text", "fast", "aborted"),
        call("text", "fast", "pending"),
        call("image", "img", "failed"),
        call("video", "vid", "pending"),
        call("text", "fast", "failed", daysAgo(30)),
      ]);
  }

  test("用户：新注册、累计、封禁和每天的注册数", async () => {
    const metrics = await getUserMetrics(db, window);
    expect(metrics).toMatchObject({
      newUsers: 3,
      totalUsers: 4,
      bannedUsers: 1,
    });
    expect(metrics.daily).toHaveLength(7);
    const byDay = Object.fromEntries(
      metrics.daily.map((p) => [p.day, p.value]),
    );
    expect(byDay[dayKey(daysAgo(1))]).toBe(2);
    expect(byDay[dayKey(daysAgo(3))]).toBe(1);
    expect(metrics.daily.reduce((sum, p) => sum + p.value, 0)).toBe(3);
  });

  test("收入：净收入按币种、付费用户、活跃订阅和 MRR", async () => {
    const metrics = await getRevenueMetrics(db, window, {
      currency: "USD",
      plans,
    });
    expect(metrics.revenue).toEqual([
      { currency: "USD", amount: 2900 },
      { currency: "EUR", amount: 500 },
    ]);
    // recent（USD）、recent2（部分退款后仍有收入）、old（EUR）；全额退款的不算。
    expect(metrics.payingUsers).toBe(3);
    expect(metrics.activeSubscriptions).toBe(4);
    // 2 × $19 + $190 ÷ 12 = 3800 + 1583.33 分。
    expect(metrics.mrr).toEqual({ currency: "USD", amount: 5383 });
    expect(metrics.unpricedSubscriptions).toBe(1);
    const byDay = Object.fromEntries(
      metrics.daily.map((p) => [p.day, p.value]),
    );
    expect(byDay[dayKey(daysAgo(1))]).toBe(1900);
    expect(byDay[dayKey(daysAgo(2))]).toBe(1000);
  });

  test("积分：发放、消耗和退款", async () => {
    expect(await getCreditMetrics(db, window)).toEqual({
      granted: 150,
      consumed: 35,
      refunded: 5,
    });
  });

  test("AI：按类型和模型的调用次数与失败率，pending 不计入失败率分母", async () => {
    const metrics = await getAiMetrics(db, window);
    expect(metrics.calls).toBe(7);
    // 失败 2 次 ÷ 已结束 5 次（text 4 + image 1）。
    expect(metrics.failureRate).toBeCloseTo(2 / 5);
    expect(metrics.models).toEqual([
      {
        kind: "text",
        modelId: "fast",
        calls: 5,
        succeeded: 2,
        failed: 1,
        failureRate: 1 / 4,
      },
      {
        kind: "image",
        modelId: "img",
        calls: 1,
        succeeded: 0,
        failed: 1,
        failureRate: 1,
      },
      {
        kind: "video",
        modelId: "vid",
        calls: 1,
        succeeded: 0,
        failed: 0,
        failureRate: null,
      },
    ]);
  });
});
