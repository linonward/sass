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

// Metrics are full-table aggregates, so the numbers are unpredictable when sharing a database with
// other tests; create a temporary database and drop it afterward.
describe.skipIf(!url)("admin metrics", () => {
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
    // Dropping the database makes the server cut lingering connections; that's not an error.
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
      // Partial refund: net revenue 1000.
      order(ids.recent2, {
        createdAt: daysAgo(2),
        status: "partially_refunded",
        amount: 1900,
        refundedAmount: 900,
      }),
      // Fully refunded, failed, and out-of-range orders don't count.
      order(ids.banned, {
        createdAt: daysAgo(2),
        status: "refunded",
        refundedAmount: 1900,
      }),
      order(ids.banned, { createdAt: daysAgo(2), status: "failed" }),
      order(ids.old, { createdAt: daysAgo(30) }),
      // Placeholder order where the refund arrived first: the collected amount is unknown, so it
      // isn't revenue (the sum would go negative); it only shows in the channel report's
      // to-reconcile column.
      order(ids.banned, {
        createdAt: daysAgo(2),
        status: "refunded",
        amount: null,
        refundedAmount: 400,
      }),
      // Collected but with an unknown amount and no refund yet: also not revenue.
      order(ids.banned, { createdAt: daysAgo(2), amount: null }),
      // Other currencies are listed separately and stay out of the daily chart.
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

  test("users: new sign-ups, total, banned, and sign-ups per day", async () => {
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

  test("revenue: net revenue per currency, paying users, active subscriptions, and MRR", async () => {
    const metrics = await getRevenueMetrics(db, window, {
      currency: "USD",
      plans,
    });
    expect(metrics.revenue).toEqual([
      { currency: "USD", amount: 2900 },
      { currency: "EUR", amount: 500 },
    ]);
    // recent (USD), recent2 (still has revenue after a partial refund), old (EUR); fully refunded
    // and unknown-amount orders don't count.
    expect(metrics.payingUsers).toBe(3);
    expect(metrics.activeSubscriptions).toBe(4);
    // 2 × $19 + $190 ÷ 12 = 3800 + 1583.33 cents.
    expect(metrics.mrr).toEqual({ currency: "USD", amount: 5383 });
    expect(metrics.unpricedSubscriptions).toBe(1);
    const byDay = Object.fromEntries(
      metrics.daily.map((p) => [p.day, p.value]),
    );
    expect(byDay[dayKey(daysAgo(1))]).toBe(1900);
    // Today only has recent2's net after partial refund; placeholder orders stay out of the daily
    // chart.
    expect(byDay[dayKey(daysAgo(2))]).toBe(1000);
  });

  test("credits: granted, consumed, and refunded", async () => {
    expect(await getCreditMetrics(db, window)).toEqual({
      granted: 150,
      consumed: 35,
      refunded: 5,
    });
  });

  test("AI: call counts and failure rates by kind and model; pending isn't in the failure-rate denominator", async () => {
    const metrics = await getAiMetrics(db, window);
    expect(metrics.calls).toBe(7);
    // 2 failures ÷ 5 finished (text 4 + image 1).
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
