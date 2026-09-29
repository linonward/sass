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

// The report aggregates whole tables, so its numbers are unpredictable when sharing a database with
// other tests. Each describe therefore creates a temporary database and drops it afterwards.
async function openTestDatabase() {
  const name = `acquisition_report_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: url });
  await admin.query(`create database ${name}`);
  const testUrl = new URL(url!);
  testUrl.pathname = `/${name}`;
  const pool = new Pool({ connectionString: testUrl.toString() });
  // Dropping the database makes the server cut leftover connections; that's not an error.
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

describe.skipIf(!url)("channel report", () => {
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
      // Traffic that really sets utm_source to unknown: not the same row as "no attribution".
      {
        userId: ids.literal,
        snapshot: snapshot("unknown"),
        registeredAt: daysAgo(2),
      },
      // Tombstone left by a withdrawal: null snapshot, goes into the synthetic bucket.
      {
        userId: ids.withdrawn,
        snapshot: null,
        registeredAt: daysAgo(2),
        withdrawnAt: daysAgo(1),
      },
      // An existing user who signed up before attribution was on: no row, also in the synthetic
      // bucket. ids.legacy is deliberately not written.
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
      // launch: two orders from one user (a renewal) count as one paying user, summed per currency.
      order(ids.launch, { createdAt: daysAgo(1) }),
      order(ids.launch, {
        createdAt: daysAgo(2),
        amount: 500,
        currency: "EUR",
      }),
      // An order exactly at the start of the range is inside it.
      order(ids.direct, { createdAt: week.since, amount: 1000 }),
      // One millisecond before the start is not.
      order(ids.hacker, {
        createdAt: new Date(week.since.getTime() - 1),
        amount: 5000,
      }),
      // Placeholder order where the refund arrived first: unknown amount, only needs reconciling,
      // not a paying user.
      order(ids.hacker, {
        createdAt: daysAgo(2),
        status: "refunded",
        amount: null,
        refundedAmount: 400,
      }),
      // Partial refund: net revenue 750.
      order(ids.legacy, {
        createdAt: daysAgo(3),
        status: "partially_refunded",
        amount: 1000,
        refundedAmount: 250,
      }),
      // Full refund: net revenue 0, no longer a paying user.
      order(ids.withdrawn, {
        createdAt: daysAgo(2),
        status: "refunded",
        refundedAmount: 1900,
      }),
      // Failed orders don't count; a failed order with an unknown amount shouldn't land in needs-
      // reconciling either.
      order(ids.legacy, {
        createdAt: daysAgo(3),
        status: "failed",
        amount: null,
      }),
      // An order outside the range shows up in 90 days, not in 7 days.
      order(ids.old, { createdAt: daysAgo(30) }),
      // Collected, amount unknown, no refund yet: needs reconciling with 0, rather than silently
      // vanishing.
      order(ids.direct, { createdAt: daysAgo(1), amount: null }),
      // A literal unknown source gets its own row.
      order(ids.literal, { createdAt: daysAgo(2), amount: 800 }),
    ]);
  }

  test("groups by frozen source: registrations, deduplicated paying users, net revenue per currency", async () => {
    const rows = await getAcquisitionReport(db, week);
    expect(rows.map((entry) => entry.source)).toEqual([
      NO_SOURCE_BUCKET,
      "direct",
      "launch",
      "unknown",
      "news.ycombinator.com",
    ]);

    // Users without an attribution row and withdrawal tombstones both go into the synthetic bucket;
    // fully refunded users aren't paying users.
    expect(rowOf(rows, NO_SOURCE_BUCKET)).toEqual({
      source: NO_SOURCE_BUCKET,
      registrations: 2,
      payingUsers: 1,
      revenue: [{ currency: "USD", amount: 750 }],
      pending: [],
      confirmedLeads: 0,
      conversionRate: 0,
    });

    // A literal utm_source=unknown is its own row, not merged into the synthetic bucket.
    expect(rowOf(rows, "unknown")).toEqual({
      source: "unknown",
      registrations: 1,
      payingUsers: 1,
      revenue: [{ currency: "USD", amount: 800 }],
      pending: [],
      confirmedLeads: 0,
      conversionRate: 0,
    });

    // Two orders (including a renewal in another currency) count as one paying user; full refunds
    // aren't listed as revenue.
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

    // An order with an unknown amount and no refund yet shows 0: it means no refund yet, not that
    // it's settled.
    expect(rowOf(rows, "direct")).toEqual({
      source: "direct",
      registrations: 1,
      payingUsers: 1,
      revenue: [{ currency: "USD", amount: 1000 }],
      pending: [{ currency: "USD", amount: 0 }],
      confirmedLeads: 0,
      conversionRate: 0,
    });

    // A placeholder order whose refund arrived first is listed separately as needs reconciling and
    // isn't a paying user.
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

  test("time boundaries: the start instant is in, the instant before is out; 90 days brings back older orders", async () => {
    const rows = await getAcquisitionReport(db, quarter);
    expect(rowOf(rows, "news.ycombinator.com").revenue).toEqual([
      { currency: "USD", amount: 5000 },
    ]);
    expect(rowOf(rows, "news.ycombinator.com").payingUsers).toBe(1);
    // Registrations and orders from 30 days ago show up in 90 days: one more registration and
    // paying user for the same source.
    expect(rowOf(rows, "launch")).toMatchObject({
      registrations: 2,
      payingUsers: 2,
      revenue: [
        { currency: "USD", amount: 3800 },
        { currency: "EUR", amount: 500 },
      ],
    });
  });

  test("source filter: the synthetic bucket and literal unknown filter separately; unknown values return an empty table", async () => {
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

  test("medium / campaign filters: registrations, orders, and needs-reconciling all filter on the same snapshot", async () => {
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

  test("filter options cover every table row, including the synthetic bucket", async () => {
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

  test("basis check: report rows add up to /admin/metrics net revenue and paying users", async () => {
    const rows = await getAcquisitionReport(db, week);
    // The report groups currencies as they appear on orders; the data here is all uppercase, so add
    // back per currency directly.
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
    // The daily chart only counts billing.currency, and its total equals that currency's net
    // revenue.
    expect(metrics.daily.reduce((sum, point) => sum + point.value, 0)).toBe(
      4450,
    );
  });
});

// Under the old logic the synthetic bucket only showed up in the filter thanks to tombstones (null
// snapshot). This database has neither: only users missing an attribution row, plus one source
// that only appears in lead snapshots.
describe.skipIf(!url)(
  "channel report: database with no attribution rows and no tombstones",
  () => {
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
        // Cumulative net revenue of 3 × 1_000_000_000 exceeds the int4 maximum.
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

    test("filter options include the synthetic bucket and lead-only sources, but not sources of unconfirmed leads", async () => {
      expect((await getFilterOptions(db)).sources).toEqual([
        NO_SOURCE_BUCKET,
        "big.example.com",
        "partner.example.com",
      ]);
    });

    test("users missing an attribution row get their own row, and lead-only sources get a row too", async () => {
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

    test("both pages return numbers when cumulative amounts exceed the int4 maximum", async () => {
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
  },
);
