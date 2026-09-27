// @vitest-environment node
import { randomUUID } from "node:crypto";
import path from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { metricWindow } from "@/core/admin/metrics";
import type { Database } from "@/core/db/client";
import * as schema from "@/core/db/schema";
import { orders, user, userAttribution } from "@/core/db/schema";

import { getAcquisitionReport, getFilterOptions } from "./report";

const url = process.env.DATABASE_URL_TEST;

if (!url && process.env.CI) {
  throw new Error("DATABASE_URL_TEST must be set in CI");
}

// 报表是全表聚合，和其他用例共用一个库时数字不确定，所以建一个临时库，跑完删掉。
describe.skipIf(!url)("渠道报表", () => {
  const dbName = `acquisition_report_test_${randomUUID().replaceAll("-", "")}`;
  let admin: Pool;
  let pool: Pool;
  let db: Database;

  const now = new Date();
  const week = metricWindow(7, now);
  const quarter = metricWindow(90, now);
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

  const ids = {
    launch: "u-launch",
    hacker: "u-hacker",
    direct: "u-direct",
    unknown: "u-unknown",
    withdrawn: "u-withdrawn",
    old: "u-old",
  };

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

  async function seed() {
    await db.insert(user).values(
      Object.entries({
        launch: 1,
        hacker: 3,
        direct: 3,
        unknown: 1,
        withdrawn: 2,
        old: 30,
      }).map(([key, days]) => ({
        id: ids[key as keyof typeof ids],
        name: key,
        email: `${key}@example.com`,
        createdAt: daysAgo(days),
      })),
    );

    const snapshot = (
      source: string,
      extra: { utm_medium?: string; utm_campaign?: string } = {},
    ) => ({
      pathname: "/",
      capturedAt: now.getTime(),
      source,
      ...extra,
    });
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
      // 撤回留下的墓碑：快照为 null，算 unknown。
      {
        userId: ids.withdrawn,
        snapshot: null,
        registeredAt: daysAgo(2),
        withdrawnAt: daysAgo(1),
      },
      // 归因开启前注册的老用户：没有这一行，也算 unknown。ids.unknown 故意不写。
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
      order(ids.unknown, {
        createdAt: daysAgo(3),
        status: "partially_refunded",
        amount: 1000,
        refundedAmount: 250,
      }),
      // 全额退款：净收入 0，付费人数仍算付过款。
      order(ids.withdrawn, {
        createdAt: daysAgo(2),
        status: "refunded",
        refundedAmount: 1900,
      }),
      // 失败订单不计入。
      order(ids.unknown, { createdAt: daysAgo(3), status: "failed" }),
      // 区间外的订单进 90 天，不进 7 天。
      order(ids.old, { createdAt: daysAgo(30) }),
    ]);
  }

  const row = (
    rows: Awaited<ReturnType<typeof getAcquisitionReport>>,
    source: string,
  ) => rows.find((entry) => entry.source === source)!;

  test("按冻结来源分组：注册、付费人数去重、按币种净收入", async () => {
    const rows = await getAcquisitionReport(db, week);
    expect(rows.map((entry) => entry.source)).toEqual([
      "unknown",
      "direct",
      "launch",
      "news.ycombinator.com",
    ]);

    // 没有归因行的老用户和撤回后的墓碑都归到 unknown。
    expect(row(rows, "unknown")).toEqual({
      source: "unknown",
      registrations: 2,
      payingUsers: 2,
      revenue: [{ currency: "USD", amount: 750 }],
      pending: [],
    });

    // 两笔订单（含续费、另一币种）只算一个付费用户；全额退款的不列收入。
    expect(row(rows, "launch")).toEqual({
      source: "launch",
      registrations: 1,
      payingUsers: 1,
      revenue: [
        { currency: "USD", amount: 1900 },
        { currency: "EUR", amount: 500 },
      ],
      pending: [],
    });

    expect(row(rows, "direct")).toEqual({
      source: "direct",
      registrations: 1,
      payingUsers: 1,
      revenue: [{ currency: "USD", amount: 1000 }],
      pending: [],
    });

    // 退款先到的占位订单单列待核对，也不算付费人数。
    expect(row(rows, "news.ycombinator.com")).toEqual({
      source: "news.ycombinator.com",
      registrations: 1,
      payingUsers: 0,
      revenue: [],
      pending: [{ currency: "USD", amount: 400 }],
    });
  });

  test("时间边界：起点当刻算内、起点前一刻算外；90 天补回更早的订单", async () => {
    const rows = await getAcquisitionReport(db, quarter);
    expect(row(rows, "news.ycombinator.com").revenue).toEqual([
      { currency: "USD", amount: 5000 },
    ]);
    expect(row(rows, "news.ycombinator.com").payingUsers).toBe(1);
    // 30 天前的注册和订单进 90 天：同一来源多一个注册、一个付费用户。
    expect(row(rows, "launch")).toMatchObject({
      registrations: 2,
      payingUsers: 2,
      revenue: [
        { currency: "USD", amount: 3800 },
        { currency: "EUR", amount: 500 },
      ],
    });
  });

  test("筛来源：unknown 是独立的一桶，未知取值返回空表", async () => {
    const unknown = await getAcquisitionReport(db, week, { source: "unknown" });
    expect(unknown.map((entry) => entry.source)).toEqual(["unknown"]);
    expect(unknown[0]).toMatchObject({ registrations: 2, payingUsers: 2 });

    expect(await getAcquisitionReport(db, week, { source: "launch" })).toEqual([
      row(await getAcquisitionReport(db, week), "launch"),
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

  test("筛选框的取值来自已保存的归因，unknown 也在列", async () => {
    expect(await getFilterOptions(db)).toEqual({
      sources: ["direct", "launch", "news.ycombinator.com", "unknown"],
      mediums: ["email"],
      campaigns: ["spring"],
    });
  });
});
