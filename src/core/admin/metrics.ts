import { and, count, countDistinct, eq, gte, inArray, sql } from "drizzle-orm";

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

// /admin/metrics 的聚合查询。按天分组都用 UTC 日期。

export const metricRanges = [7, 30, 90] as const;
export type MetricRange = (typeof metricRanges)[number];

/** 解析 ?range=：只接受 7 / 30 / 90，其他值按 30 天。 */
export function parseRange(value: unknown): MetricRange {
  const range = Number(typeof value === "string" ? value : undefined);
  return metricRanges.includes(range as MetricRange)
    ? (range as MetricRange)
    : 30;
}

export type MetricWindow = {
  /** 区间开始（含），为 UTC 零点。 */
  since: Date;
  /** 区间内的每一天（UTC，YYYY-MM-DD），最后一天是今天。 */
  days: string[];
};

/** 最近 range 天（含今天）的区间。 */
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

/** 把按天的查询结果补齐成区间内每天一个点，没有数据的天为 0。 */
export function fillDays(
  days: string[],
  rows: { day: string; value: number }[],
): DailyPoint[] {
  const byDay = new Map(rows.map((row) => [row.day, row.value]));
  return days.map((day) => ({ day, value: byDay.get(day) ?? 0 }));
}

const dayOf = (column: AnyPgColumn) =>
  sql<string>`to_char(date_trunc('day', ${column}), 'YYYY-MM-DD')`;

/** 用户：区间内新注册、累计用户、当前被封禁的用户，以及每天的注册数。 */
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

// 有过实际收款的订单状态；退款金额在 refunded_amount 里扣除。
const collectedStatuses = ["paid", "partially_refunded", "refunded"] as const;

export type Money = { currency: string; amount: number };

/**
 * 收入（金额都以最小货币单位计）：
 * - revenue：区间内创建的订单净收入（金额减去已退款），按币种
 * - payingUsers：区间内有净收入订单的用户数
 * - activeSubscriptions：当前状态为 active 的订阅数
 * - mrr：active 订阅按 site.config.ts 里的套餐原价折算的月收入（年付 ÷ 12），
 *   币种是 billing.currency。套餐已从配置删除的订阅计入 unpricedSubscriptions。
 * - daily：每天的净收入，只统计 billing.currency。
 */
export async function getRevenueMetrics(
  db: Database,
  window: MetricWindow,
  billing: Pick<SiteConfig["billing"], "currency" | "plans">,
) {
  const net = sql<number>`coalesce(sum(${orders.amount} - ${orders.refundedAmount}), 0)::int`;
  const collected = and(
    gte(orders.createdAt, window.since),
    inArray(orders.status, collectedStatuses),
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
      .where(
        and(collected, sql`${orders.amount} - ${orders.refundedAmount} > 0`),
      ),
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

  // 套餐价格以主币单位配置（19 表示 $19），换算成分再按月折算。
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
    revenue: revenue
      .filter((row) => row.amount !== 0)
      .map((row) => ({
        currency: (row.currency ?? billing.currency).toUpperCase(),
        amount: row.amount,
      }))
      .sort((a, b) => b.amount - a.amount) satisfies Money[],
    payingUsers: paying!.value,
    activeSubscriptions: active.reduce((sum, row) => sum + row.value, 0),
    mrr: {
      currency: billing.currency,
      amount: Math.round(mrr),
    } satisfies Money,
    unpricedSubscriptions,
    daily: fillDays(window.days, daily),
  };
}

/** 积分：区间内发放（grant）、消耗（deduct，取正数）和退款（refund）的总量。 */
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
  /** 失败率 = failed ÷ 已结束的调用（succeeded + failed + aborted）；没有已结束的调用时为 null。 */
  failureRate: number | null;
};

/** AI：区间内按类型和模型分组的调用次数与失败率，调用多的在前。 */
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
