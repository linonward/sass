import {
  and,
  count,
  countDistinct,
  eq,
  gte,
  inArray,
  isNotNull,
  sql,
  type SQL,
} from "drizzle-orm";

import type { AnyPgColumn } from "drizzle-orm/pg-core";

import type { SiteConfig } from "@/core/config/schema";
import type { Database } from "@/core/db/client";
import {
  aiUsage,
  creditTransactions,
  orders,
  subscriptions,
  user,
  type AiUsageKind,
} from "@/core/db/schema";

// Aggregate queries for /admin/metrics. All per-day grouping uses UTC dates.

export const metricRanges = [7, 30, 90] as const;
export type MetricRange = (typeof metricRanges)[number];

/** Parses ?range=: only 7 / 30 / 90 are accepted; anything else means 30 days. */
export function parseRange(value: unknown): MetricRange {
  const range = Number(typeof value === "string" ? value : undefined);
  return metricRanges.includes(range as MetricRange)
    ? (range as MetricRange)
    : 30;
}

export type MetricWindow = {
  /** Range start (inclusive), at UTC midnight. */
  since: Date;
  /** Every day in the range (UTC, YYYY-MM-DD); the last one is today. */
  days: string[];
};

/** The range covering the last `range` days (including today). */
export function metricWindow(
  range: MetricRange,
  now = new Date(),
): MetricWindow {
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const dayMs = 24 * 60 * 60 * 1000;
  const since = new Date(today - (range - 1) * dayMs);
  const days = Array.from({ length: range }, (_, i) =>
    new Date(since.getTime() + i * dayMs).toISOString().slice(0, 10),
  );
  return { since, days };
}

export type DailyPoint = { day: string; value: number };

/** Fills per-day query results out to one point per day in the range; days without data are 0. */
export function fillDays(
  days: string[],
  rows: { day: string; value: number }[],
): DailyPoint[] {
  const byDay = new Map(rows.map((row) => [row.day, row.value]));
  return days.map((day) => ({ day, value: byDay.get(day) ?? 0 }));
}

const dayOf = (column: AnyPgColumn) =>
  sql<string>`to_char(date_trunc('day', ${column}), 'YYYY-MM-DD')`;

/** Users: new sign-ups in the range, total users, currently banned users, and sign-ups per day. */
export async function getUserMetrics(db: Database, window: MetricWindow) {
  const inWindow = gte(user.createdAt, window.since);
  const [[totals], daily] = await Promise.all([
    db
      .select({
        total: count(),
        banned: count(sql`case when ${user.banned} then 1 end`),
        new: count(sql`case when ${inWindow} then 1 end`),
      })
      .from(user),
    db
      .select({ day: dayOf(user.createdAt), value: count() })
      .from(user)
      .where(inWindow)
      .groupBy(sql`1`),
  ]);
  return {
    newUsers: totals!.new,
    totalUsers: totals!.total,
    bannedUsers: totals!.banned,
    daily: fillDays(window.days, daily),
  };
}

// Revenue definition: /admin/metrics and /admin/acquisition share the definitions below; the
// buyer-facing explanation is in the "Revenue definition" section of the README. Both pages take
// their conditions from here, so the definitions can't drift apart.
//
// - Orders counted as revenue (recognizedOrder): status is one of collectedStatuses **and the
//   amount is known**. Placeholder orders whose payment event hasn't arrived yet (typically when
//   the refund arrives first) have untrustworthy amounts: they count neither as revenue nor toward
//   paying users.
// - Net revenue (orderNet): amount − refunded_amount summed per currency over recognized orders.
//   Refunds are deducted at their cumulative value at query time, so historical ranges change as
//   later refunds come in.
// - Paying users (hasPositiveNet): distinct users with at least one order with positive net
//   revenue. Fully refunded users don't count as paying; multiple orders from one user (including
//   renewals) count once.
/** Order statuses where money was actually collected; refunds are deducted via refunded_amount. */
export const collectedStatuses = [
  "paid",
  "partially_refunded",
  "refunded",
] as const;

/**
 * Status and amount conditions for recognized revenue, without a time range; callers AND in the
 * window start themselves.
 */
export const recognizedOrder: SQL[] = [
  inArray(orders.status, collectedStatuses),
  isNotNull(orders.amount),
];

/** Net revenue of a single order (all amounts in the smallest currency unit). */
export const orderNet = sql`coalesce(${orders.amount}, 0) - coalesce(${orders.refundedAmount}, 0)`;

/** Paying users are determined by "has an order with positive net revenue". */
export const hasPositiveNet = sql`${orderNet} > 0`;

/**
 * Aggregated amounts are read as bigint: a single amount is bounded by its int4 column, but sums
 * can exceed the int4 max (2147483647 cents), and `::int` would 500 the whole page. pg reads int8
 * as a string, which `toAmount` converts back to a number (amounts here are still cents, so no
 * precision is lost).
 */
export const sumAmounts = (expression: SQL | AnyPgColumn) =>
  sql<string>`coalesce(sum(${expression}), 0)::bigint`;

export const toAmount = (value: string) => Number(value);

export type Money = { currency: string; amount: number };

/**
 * Revenue (all amounts in the smallest currency unit; see "Revenue definition" at the top of the
 * file):
 * - revenue: net revenue of recognized orders in the range, per currency
 * - payingUsers: users with an order with positive net revenue in the range
 * - activeSubscriptions: subscriptions currently active
 * - mrr: monthly revenue of active subscriptions at the list prices in site.config.ts (yearly ÷
 *   12), in billing.currency. Subscriptions whose plan was removed from the config count toward
 *   unpricedSubscriptions.
 * - daily: net revenue per day, billing.currency only.
 */
export async function getRevenueMetrics(
  db: Database,
  window: MetricWindow,
  billing: Pick<SiteConfig["billing"], "currency" | "plans">,
) {
  const net = sumAmounts(orderNet);
  const collected = and(
    gte(orders.createdAt, window.since),
    ...recognizedOrder,
  );
  const [revenue, [paying], active, daily] = await Promise.all([
    db
      .select({ currency: orders.currency, amount: net })
      .from(orders)
      .where(collected)
      .groupBy(orders.currency),
    db
      .select({ value: countDistinct(orders.userId) })
      .from(orders)
      .where(and(collected, hasPositiveNet)),
    db
      .select({ planId: subscriptions.planId, value: count() })
      .from(subscriptions)
      .where(eq(subscriptions.status, "active"))
      .groupBy(subscriptions.planId),
    db
      .select({ day: dayOf(orders.createdAt), value: net })
      .from(orders)
      .where(
        and(
          collected,
          sql`upper(${orders.currency}) = ${billing.currency.toUpperCase()}`,
        ),
      )
      .groupBy(sql`1`),
  ]);

  // Plan prices are configured in major units (19 means $19); convert to cents, then to monthly.
  let mrr = 0;
  let unpricedSubscriptions = 0;
  for (const row of active) {
    const plan = billing.plans.find((p) => p.id === row.planId);
    if (!plan || plan.interval === "once") {
      unpricedSubscriptions += row.value;
      continue;
    }
    const cents = Math.round(plan.price * 100);
    mrr += (plan.interval === "year" ? cents / 12 : cents) * row.value;
  }

  return {
    // Aggregates come back as bigint strings (see sumAmounts); convert to numbers before
    // returning.
    revenue: revenue
      .map((row) => ({
        currency: (row.currency ?? billing.currency).toUpperCase(),
        amount: toAmount(row.amount),
      }))
      .filter((row) => row.amount !== 0)
      .sort((a, b) => b.amount - a.amount) satisfies Money[],
    payingUsers: paying!.value,
    activeSubscriptions: active.reduce((sum, row) => sum + row.value, 0),
    mrr: {
      currency: billing.currency,
      amount: Math.round(mrr),
    } satisfies Money,
    unpricedSubscriptions,
    daily: fillDays(
      window.days,
      daily.map((row) => ({ day: row.day, value: toAmount(row.value) })),
    ),
  };
}

/**
 * Credits: totals granted (grant), consumed (deduct, as a positive number), and refunded (refund)
 * in the range.
 */
export async function getCreditMetrics(db: Database, window: MetricWindow) {
  const sumOf = (type: string) =>
    sql<number>`coalesce(sum(abs(${creditTransactions.amount})) filter (where ${creditTransactions.type} = ${type}), 0)::int`;
  const [row] = await db
    .select({
      granted: sumOf("grant"),
      consumed: sumOf("deduct"),
      refunded: sumOf("refund"),
    })
    .from(creditTransactions)
    .where(gte(creditTransactions.createdAt, window.since));
  return row!;
}

export type AiModelMetrics = {
  kind: AiUsageKind;
  modelId: string;
  calls: number;
  succeeded: number;
  failed: number;
  /**
   * Failure rate = failed ÷ finished calls (succeeded + failed + aborted); null when no calls have
   * finished.
   */
  failureRate: number | null;
};

/** AI: call counts and failure rates in the range grouped by kind and model, busiest first. */
export async function getAiMetrics(db: Database, window: MetricWindow) {
  const byStatus = (status: string) =>
    count(sql`case when ${aiUsage.status} = ${status} then 1 end`);
  const rows = await db
    .select({
      kind: aiUsage.kind,
      modelId: aiUsage.modelId,
      calls: count(),
      succeeded: byStatus("succeeded"),
      failed: byStatus("failed"),
      aborted: byStatus("aborted"),
    })
    .from(aiUsage)
    .where(gte(aiUsage.createdAt, window.since))
    .groupBy(aiUsage.kind, aiUsage.modelId);

  const models: AiModelMetrics[] = rows
    .map(({ aborted, ...row }) => {
      const finished = row.succeeded + row.failed + aborted;
      return {
        ...row,
        failureRate: finished > 0 ? row.failed / finished : null,
      };
    })
    .sort(
      (a, b) =>
        b.calls - a.calls ||
        a.kind.localeCompare(b.kind) ||
        a.modelId.localeCompare(b.modelId),
    );
  const totals = rows.reduce(
    (sum, row) => ({
      calls: sum.calls + row.calls,
      failed: sum.failed + row.failed,
      finished: sum.finished + row.succeeded + row.failed + row.aborted,
    }),
    { calls: 0, failed: 0, finished: 0 },
  );
  return {
    calls: totals.calls,
    failureRate: totals.finished > 0 ? totals.failed / totals.finished : null,
    models,
  };
}
