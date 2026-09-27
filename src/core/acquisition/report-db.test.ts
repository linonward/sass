// @vitest-environment node
import { randomUUID } from "node:crypto";
import path from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { getRevenueMetrics, metricWindow } from "@/core/admin/metrics";
import type { Database } from "@/core/db/client";
import * as schema from "@/core/db/schema";
import { leads, orders, user, userAttribution } from "@/core/db/schema";

import {
  getAcquisitionReport,
  getFilterOptions,
  NO_SOURCE_BUCKET,
  type ReportRow,
} from "./report";

const url = process.env.DATABASE_URL_TEST;

if (!url && process.env.CI) {
  throw new Error("DATABASE_URL_TEST must be set in CI");
}

// 报表是全表聚合，和其他用例共用一个库时数字不确定，所以每个 describe 建一个临时库，
// 跑完删掉。
async function openTestDatabase() {
  const name = `acquisition_report_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: url });
  await admin.query(`create database ${name}`);
  const testUrl = new URL(url!);
  testUrl.pathname = `/${name}`;
  const pool = new Pool({ connectionString: testUrl.toString() });
  // 删库时服务端会断开残留的连接，不当作错误。
  pool.on("error", () => {});
  const db = drizzle({ client: pool, schema });
  await migrate(db, {
    migrationsFolder: path.resolve(__dirname, "../../../drizzle"),
  });
  return {
    db: db as Database,
    close: async () => {
      await pool.end();
      await admin.query(`drop database if exists ${name} with (force)`);
      await admin.end();
    },
  };
}

const now = new Date();
const week = metricWindow(7, now);
const quarter = metricWindow(90, now);
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

const snapshot = (
  source: string,
  extra: { utm_medium?: string; utm_campaign?: string } = {},
) => ({
  pathname: "/",
  capturedAt: now.getTime(),
  source,
  ...extra,
});

const rowOf = (rows: ReportRow[], source: string) =>
  rows.find((entry) => entry.source === source)!;

describe.skipIf(!url)("渠道报表", () => {
  let db: Database;
  let close: () => Promise<void>;

  const ids = {
    launch: "u-launch",
    hacker: "u-hacker",
    direct: "u-direct",
    literal: "u-literal",
    withdrawn: "u-withdrawn",
    legacy: "u-legacy",
    old: "u-old",
  };

  beforeAll(async () => {
    ({ db, close } = await openTestDatabase());
    await seed();
  });

  afterAll(async () => {
    await close?.();
  });

  async function seed() {
    await db.insert(user).values(
      Object.entries({
        launch: 1,
        hacker: 3,
        direct: 3,
        literal: 2,
        withdrawn: 2,
        legacy: 1,
        old: 30,
      }).map(([key, days]) => ({
        id: ids[key as keyof typeof ids],
        name: key,
        email: `${key}@example.com`,
        createdAt: daysAgo(days),
      })),
    );

    await db.insert(userAttribution).values([
      {
        userId: ids.launch,
        snapshot: snapshot("launch", {
          utm_medium: "email",
          utm_campaign: "spring",
        }),
        registeredAt: daysAgo(1),
      },
      {
        userId: ids.hacker,
        snapshot: snapshot("news.ycombinator.com"),
        registeredAt: daysAgo(3),
      },
      {
        userId: ids.direct,
        snapshot: snapshot("direct"),
        registeredAt: daysAgo(3),
      },
      // 真的把 utm_source 填成 unknown 的流量：和「没有归因」不是同一行。
      {
        userId: ids.literal,
        snapshot: snapshot("unknown"),
        registeredAt: daysAgo(2),
      },
      // 撤回留下的墓碑：快照为 null，归到合成桶。
      {
        userId: ids.withdrawn,
        snapshot: null,
        registeredAt: daysAgo(2),
        withdrawnAt: daysAgo(1),
      },
      // 归因开启前注册的老用户：没有这一行，也归到合成桶。ids.legacy 故意不写。
      {
        userId: ids.old,
        snapshot: snapshot("launch"),
        registeredAt: daysAgo(30),
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
      // launch：同一用户两笔（续费）只算一个付费用户，按币种分别累计。
      order(ids.launch, { createdAt: daysAgo(1) }),
      order(ids.launch, {
        createdAt: daysAgo(2),
        amount: 500,
        currency: "EUR",
      }),
      // 刚好落在区间起点上的订单算在区间内。
      order(ids.direct, { createdAt: week.since, amount: 1000 }),
      // 起点前一毫秒的不算。
      order(ids.hacker, {
        createdAt: new Date(week.since.getTime() - 1),
        amount: 5000,
      }),
      // 退款先到的占位订单：金额未知，只进待核对，不算付费人数。
      order(ids.hacker, {
        createdAt: daysAgo(2),
        status: "refunded",
        amount: null,
        refundedAmount: 400,
      }),
      // 部分退款：净收入 750。
      order(ids.legacy, {
        createdAt: daysAgo(3),
        status: "partially_refunded",
        amount: 1000,
        refundedAmount: 250,
      }),
      // 全额退款：净收入 0，不再算付费人数。
      order(ids.withdrawn, {
        createdAt: daysAgo(2),
        status: "refunded",
        refundedAmount: 1900,
      }),
      // 失败订单不计入；金额未知的失败订单也不该落进待核对。
      order(ids.legacy, {
        createdAt: daysAgo(3),
        status: "failed",
        amount: null,
      }),
      // 区间外的订单进 90 天，不进 7 天。
      order(ids.old, { createdAt: daysAgo(30) }),
      // 收款但金额未知、也还没退款：列 0 的待核对，不是无声消失。
      order(ids.direct, { createdAt: daysAgo(1), amount: null }),
      // 字面量 unknown 的来源自己一行。
      order(ids.literal, { createdAt: daysAgo(2), amount: 800 }),
    ]);
  }

  test("按冻结来源分组：注册、付费人数去重、按币种净收入", async () => {
    const rows = await getAcquisitionReport(db, week);
    expect(rows.map((entry) => entry.source)).toEqual([
      NO_SOURCE_BUCKET,
      "direct",
      "launch",
      "unknown",
      "news.ycombinator.com",
    ]);

    // 没有归因行的用户和撤回后的墓碑都归到合成桶；全额退款的用户不算付费人数。
    expect(rowOf(rows, NO_SOURCE_BUCKET)).toEqual({
      source: NO_SOURCE_BUCKET,
      registrations: 2,
      payingUsers: 1,
      revenue: [{ currency: "USD", amount: 750 }],
      pending: [],
      confirmedLeads: 0,
      conversionRate: 0,
    });

    // 字面量 utm_source=unknown 是独立的一行，不并进合成桶。
    expect(rowOf(rows, "unknown")).toEqual({
      source: "unknown",
      registrations: 1,
      payingUsers: 1,
      revenue: [{ currency: "USD", amount: 800 }],
      pending: [],
      confirmedLeads: 0,
      conversionRate: 0,
    });

    // 两笔订单（含续费、另一币种）只算一个付费用户；全额退款的不列收入。
    expect(rowOf(rows, "launch")).toEqual({
      source: "launch",
      registrations: 1,
      payingUsers: 1,
      revenue: [
        { currency: "USD", amount: 1900 },
        { currency: "EUR", amount: 500 },
      ],
      pending: [],
      confirmedLeads: 0,
      conversionRate: 0,
    });

    // 金额未知又还没退款的订单列 0：表示还没有退款，不表示已经结清。
    expect(rowOf(rows, "direct")).toEqual({
      source: "direct",
      registrations: 1,
      payingUsers: 1,
      revenue: [{ currency: "USD", amount: 1000 }],
      pending: [{ currency: "USD", amount: 0 }],
      confirmedLeads: 0,
      conversionRate: 0,
    });

    // 退款先到的占位订单单列待核对，也不算付费人数。
    expect(rowOf(rows, "news.ycombinator.com")).toEqual({
      source: "news.ycombinator.com",
      registrations: 1,
      payingUsers: 0,
      revenue: [],
      pending: [{ currency: "USD", amount: 400 }],
      confirmedLeads: 0,
      conversionRate: 0,
    });
  });

  test("时间边界：起点当刻算内、起点前一刻算外；90 天补回更早的订单", async () => {
    const rows = await getAcquisitionReport(db, quarter);
    expect(rowOf(rows, "news.ycombinator.com").revenue).toEqual([
      { currency: "USD", amount: 5000 },
    ]);
    expect(rowOf(rows, "news.ycombinator.com").payingUsers).toBe(1);
    // 30 天前的注册和订单进 90 天：同一来源多一个注册、一个付费用户。
    expect(rowOf(rows, "launch")).toMatchObject({
      registrations: 2,
      payingUsers: 2,
      revenue: [
        { currency: "USD", amount: 3800 },
        { currency: "EUR", amount: 500 },
      ],
    });
  });

  test("筛来源：合成桶与字面量 unknown 各筛各的，未知取值返回空表", async () => {
    const none = await getAcquisitionReport(db, week, {
      source: NO_SOURCE_BUCKET,
    });
    expect(none.map((entry) => entry.source)).toEqual([NO_SOURCE_BUCKET]);
    expect(none[0]).toMatchObject({ registrations: 2, payingUsers: 1 });

    const literal = await getAcquisitionReport(db, week, { source: "unknown" });
    expect(literal.map((entry) => entry.source)).toEqual(["unknown"]);
    expect(literal[0]).toMatchObject({ registrations: 1, payingUsers: 1 });

    expect(await getAcquisitionReport(db, week, { source: "launch" })).toEqual([
      rowOf(await getAcquisitionReport(db, week), "launch"),
    ]);
    expect(
      await getAcquisitionReport(db, week, { source: "no-such-source" }),
    ).toEqual([]);
  });

  test("筛 medium / campaign：注册、订单、待核对都按同一份快照过滤", async () => {
    const filtered = await getAcquisitionReport(db, week, { medium: "email" });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toMatchObject({
      source: "launch",
      registrations: 1,
      payingUsers: 1,
    });
    expect(
      await getAcquisitionReport(db, week, { campaign: "spring" }),
    ).toEqual(filtered);
    expect(
      await getAcquisitionReport(db, week, { medium: "no-such-medium" }),
    ).toEqual([]);
  });

  test("筛选框的取值覆盖表格里的每一行，合成桶也在列", async () => {
    expect(await getFilterOptions(db)).toEqual({
      sources: [
        NO_SOURCE_BUCKET,
        "direct",
        "launch",
        "news.ycombinator.com",
        "unknown",
      ],
      mediums: ["email"],
      campaigns: ["spring"],
    });
  });

  test("口径对照：报表逐行相加等于 /admin/metrics 的净收入与付费人数", async () => {
    const rows = await getAcquisitionReport(db, week);
    // 币种在报表里按订单原样分组，这里的数据都是大写，直接按币种加回去。
    const totals = new Map<string, number>();
    for (const entry of rows)
      for (const money of entry.revenue) {
        const currency = money.currency ?? "";
        totals.set(currency, (totals.get(currency) ?? 0) + money.amount);
      }
    const metrics = await getRevenueMetrics(db, week, {
      currency: "USD",
      plans: [],
    });
    expect(metrics.revenue).toEqual(
      [...totals]
        .map(([currency, amount]) => ({ currency, amount }))
        .sort((a, b) => b.amount - a.amount),
    );
    expect(metrics.payingUsers).toBe(
      rows.reduce((sum, entry) => sum + entry.payingUsers, 0),
    );
    // 每日图只统计 billing.currency，合计等于该币种的净收入。
    expect(metrics.daily.reduce((sum, point) => sum + point.value, 0)).toBe(
      4450,
    );
  });
});

// 合成桶在旧口径里靠墓碑（快照为 null）才出现在筛选框里，这个库两者都没有：
// 只有「缺归因行」的用户，另有一条只出现在线索快照里的来源。
describe.skipIf(!url)("渠道报表：没有归因行、也没有墓碑的库", () => {
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await openTestDatabase());
    await seed();
  });

  afterAll(async () => {
    await close?.();
  });

  async function seed() {
    await db.insert(user).values([
      {
        id: "u-fresh",
        name: "fresh",
        email: "fresh@example.com",
        createdAt: daysAgo(1),
      },
      // 累计净收入 3 × 1_000_000_000，超过 int4 上限。
      {
        id: "u-big",
        name: "big",
        email: "big@example.com",
        createdAt: daysAgo(2),
      },
    ]);
    await db.insert(userAttribution).values([
      {
        userId: "u-big",
        snapshot: snapshot("big.example.com"),
        registeredAt: daysAgo(2),
      },
    ]);
    await db.insert(orders).values(
      Array.from({ length: 3 }, () => ({
        userId: "u-big",
        provider: "fake",
        providerOrderId: randomUUID(),
        status: "paid" as const,
        amount: 1_000_000_000,
        currency: "USD",
        createdAt: daysAgo(2),
      })),
    );
    await db.insert(leads).values([
      {
        id: "lead-confirmed",
        listId: "list",
        email: "lead@example.com",
        status: "confirmed",
        snapshot: snapshot("partner.example.com"),
        createdAt: daysAgo(2),
        expiresAt: daysAgo(-1),
      },
      {
        id: "lead-pending",
        listId: "list",
        email: "pending@example.com",
        status: "pending",
        snapshot: snapshot("pending.example.com"),
        createdAt: daysAgo(2),
        expiresAt: daysAgo(-1),
      },
    ]);
  }

  test("筛选框里有合成桶和只在线索里的来源，未确认线索的来源不在", async () => {
    expect((await getFilterOptions(db)).sources).toEqual([
      NO_SOURCE_BUCKET,
      "big.example.com",
      "partner.example.com",
    ]);
  });

  test("缺归因行的用户自成一行，只在线索里的来源也有一行", async () => {
    const rows = await getAcquisitionReport(db, week);
    expect(rowOf(rows, NO_SOURCE_BUCKET)).toMatchObject({
      registrations: 1,
      payingUsers: 0,
      revenue: [],
      pending: [],
    });
    expect(rowOf(rows, "partner.example.com")).toMatchObject({
      registrations: 0,
      confirmedLeads: 1,
      conversionRate: null,
    });
  });

  test("累计金额超过 int4 上限时两页都给数字", async () => {
    const rows = await getAcquisitionReport(db, week);
    expect(rowOf(rows, "big.example.com").revenue).toEqual([
      { currency: "USD", amount: 3_000_000_000 },
    ]);
    const metrics = await getRevenueMetrics(db, week, {
      currency: "USD",
      plans: [],
    });
    expect(metrics.revenue).toEqual([
      { currency: "USD", amount: 3_000_000_000 },
    ]);
    expect(metrics.daily.reduce((sum, point) => sum + point.value, 0)).toBe(
      3_000_000_000,
    );
  });
});
