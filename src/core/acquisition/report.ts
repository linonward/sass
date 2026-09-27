import {
  and,
  count,
  countDistinct,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  sql,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";

import { collectedStatuses, type MetricWindow } from "@/core/admin/metrics";
import type { Database } from "@/core/db/client";
import { orders, user, userAttribution } from "@/core/db/schema";

import { campaignField, sourceField } from "./context";

// /admin/acquisition 的渠道报表聚合。时间口径直接复用 /admin/metrics 的实现：
// UTC 半开区间、7 / 30 / 90 天。收入按**订单归属期**（区间内创建的订单）算，
// 退款按查询时的累计值扣，所以历史区间会随之后的退款变化。

/**
 * 冻结来源（快照里的 source）。没有归因行（功能开启前注册的老用户、跨设备）和
 * 已撤回（快照为 null）都算 unknown；direct 是确实没有来源，两者在报表里是两行。
 * 表达式要和 schema 里的 `user_attribution_source_idx` 完全一致才走得到索引。
 */
const sourceOf = sql<string>`coalesce(${userAttribution.snapshot}->>'source', 'unknown')`;
const mediumOf = sql<string | null>`${userAttribution.snapshot}->>'utm_medium'`;
const campaignOf = sql<
  string | null
>`${userAttribution.snapshot}->>'utm_campaign'`;

export type ReportFilters = {
  source?: string;
  medium?: string;
  campaign?: string;
};

/**
 * 解析 ?source= / ?medium= / ?campaign=：只接受能写进快照的取值（见 context.ts 的
 * 校验规则），其他值一律当作没传，不把它们带进查询。
 */
export function parseReportFilters(query: {
  source?: unknown;
  medium?: unknown;
  campaign?: unknown;
}): ReportFilters {
  const pick = (schema: z.ZodType<string>, value: unknown) => {
    const parsed = schema.safeParse(
      typeof value === "string" ? value : undefined,
    );
    return parsed.success ? parsed.data : undefined;
  };
  return {
    source: pick(sourceField, query.source),
    medium: pick(campaignField, query.medium),
    campaign: pick(campaignField, query.campaign),
  };
}

export type Money = { currency: string | null; amount: number };

export type ReportRow = {
  source: string;
  registrations: number;
  payingUsers: number;
  /** 净收入：区间内成功付款的订单金额减去这些订单截至查询时的累计退款，按币种。 */
  revenue: Money[];
  /** 待核对：退款先到、订单金额还没补齐的退款额，不计入净收入。 */
  pending: Money[];
};

type Counted = { source: string; value: number };
type Priced = Counted & { currency: string | null };

/**
 * 四组聚合按来源合并成一行：在任一组里出现过就有一行，没出现的填 0。
 * 净收入为 0 的币种不列（全额退款的订单不该显示成一行「0」），待核对原样列出。
 */
export function mergeRows({
  registrations,
  payers,
  revenue,
  pending,
}: {
  registrations: Counted[];
  payers: Counted[];
  revenue: Priced[];
  pending: Priced[];
}): ReportRow[] {
  const rows = new Map<string, ReportRow>();
  const row = (source: string) => {
    const existing = rows.get(source) ?? {
      source,
      registrations: 0,
      payingUsers: 0,
      revenue: [],
      pending: [],
    };
    rows.set(source, existing);
    return existing;
  };
  for (const item of registrations) row(item.source).registrations = item.value;
  for (const item of payers) row(item.source).payingUsers = item.value;
  for (const item of revenue)
    if (item.value !== 0)
      row(item.source).revenue.push({
        currency: item.currency,
        amount: item.value,
      });
  for (const item of pending)
    row(item.source).pending.push({
      currency: item.currency,
      amount: item.value,
    });

  const byAmount = (a: Money, b: Money) => b.amount - a.amount;
  return [...rows.values()]
    .map((entry) => ({
      ...entry,
      revenue: entry.revenue.sort(byAmount),
      pending: entry.pending.sort(byAmount),
    }))
    .sort(
      (a, b) =>
        b.registrations - a.registrations ||
        b.payingUsers - a.payingUsers ||
        a.source.localeCompare(b.source),
    );
}

/** 三个筛选都用快照字段上的表达式，和 schema 里的表达式索引对上。 */
function filterWhere(filters: ReportFilters) {
  const clauses: SQL[] = [];
  if (filters.source) clauses.push(sql`${sourceOf} = ${filters.source}`);
  if (filters.medium) clauses.push(sql`${mediumOf} = ${filters.medium}`);
  if (filters.campaign) clauses.push(sql`${campaignOf} = ${filters.campaign}`);
  return clauses;
}

/**
 * 区间内按冻结来源分组的注册数、付费人数、按币种的净收入与待核对退款。
 *
 * 付费人数是「区间内成功付款过的用户」去重（全额退款过也算付过款，退款额在收入那一列）。
 * 金额未知的占位订单（退款先到、付款事件还没补齐）不算付款，只进待核对 ——
 * 混进收入会把它当成零退款，净收入变成负数。
 */
export async function getAcquisitionReport(
  db: Database,
  window: MetricWindow,
  filters: ReportFilters = {},
): Promise<ReportRow[]> {
  const where = filterWhere(filters);
  const paid = and(
    gte(orders.createdAt, window.since),
    inArray(orders.status, collectedStatuses),
    isNotNull(orders.amount),
    ...where,
  );
  const [registrations, payers, revenue, pending] = await Promise.all([
    db
      .select({ source: sourceOf, value: count() })
      .from(user)
      .leftJoin(userAttribution, eq(userAttribution.userId, user.id))
      .where(and(gte(user.createdAt, window.since), ...where))
      .groupBy(sql`1`),
    db
      .select({ source: sourceOf, value: countDistinct(orders.userId) })
      .from(orders)
      .leftJoin(userAttribution, eq(userAttribution.userId, orders.userId))
      .where(paid)
      .groupBy(sql`1`),
    db
      .select({
        source: sourceOf,
        currency: orders.currency,
        value: sql<number>`coalesce(sum(${orders.amount} - ${orders.refundedAmount}), 0)::int`,
      })
      .from(orders)
      .leftJoin(userAttribution, eq(userAttribution.userId, orders.userId))
      .where(paid)
      .groupBy(sql`1`, orders.currency),
    db
      .select({
        source: sourceOf,
        currency: orders.currency,
        value: sql<number>`coalesce(sum(${orders.refundedAmount}), 0)::int`,
      })
      .from(orders)
      .leftJoin(userAttribution, eq(userAttribution.userId, orders.userId))
      .where(
        and(
          gte(orders.createdAt, window.since),
          isNull(orders.amount),
          gt(orders.refundedAmount, 0),
          ...where,
        ),
      )
      .groupBy(sql`1`, orders.currency),
  ]);
  return mergeRows({ registrations, payers, revenue, pending });
}

export type FilterOptions = {
  sources: string[];
  mediums: string[];
  campaigns: string[];
};

/** 筛选框里的取值：从已保存的归因里取，用过哪些渠道就列哪些，取不到就只剩「全部」。 */
export async function getFilterOptions(db: Database): Promise<FilterOptions> {
  const [sources, mediums, campaigns] = await Promise.all([
    db.select({ value: sourceOf }).from(userAttribution).groupBy(sourceOf),
    db
      .selectDistinct({ value: mediumOf })
      .from(userAttribution)
      .where(isNotNull(mediumOf)),
    db
      .selectDistinct({ value: campaignOf })
      .from(userAttribution)
      .where(isNotNull(campaignOf)),
  ]);
  const values = (rows: { value: string | null }[]) =>
    rows
      .flatMap((entry) => (entry.value === null ? [] : [entry.value]))
      .sort((a, b) => a.localeCompare(b));
  return {
    sources: values(sources),
    mediums: values(mediums),
    campaigns: values(campaigns),
  };
}
