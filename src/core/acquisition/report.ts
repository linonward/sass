import {
  and,
  count,
  countDistinct,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  sql,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";

import {
  collectedStatuses,
  hasPositiveNet,
  orderNet,
  recognizedOrder,
  sumAmounts,
  toAmount,
  type MetricWindow,
} from "@/core/admin/metrics";
import type { Database } from "@/core/db/client";
import { leads, orders, user, userAttribution } from "@/core/db/schema";

import { campaignField, sourceField } from "./context";

// /admin/acquisition 的渠道报表聚合。时间口径直接复用 /admin/metrics 的实现：
// UTC 半开区间、7 / 30 / 90 天。收入口径同样与 /admin/metrics 共用（见 metrics.ts
// 开头的「收入口径」，买家说明在 README 的「收入口径」一节）：收入按**订单归属期**
// （区间内创建的订单）算，退款按查询时的累计值扣，所以历史区间会随之后的退款变化。

/**
 * 「没有可用归因」的合成桶。没有归因行（功能开启前注册的老用户、跨设备）和已撤回
 * （快照为 null）都落在它上面。取值故意做成不可能出现在快照里的字符串（括号不在
 * context.ts 的白名单字符集里），所以真的把 utm_source 填成 `unknown` 的流量是**独立
 * 的一行**，不会和「没有归因」混在一起；筛选框里两个取值也都列得出来。
 */
export const NO_SOURCE_BUCKET = "(none)";

/**
 * 冻结来源（快照里的 source）。direct 是确实没有来源，和 NO_SOURCE_BUCKET 是两行。
 */
const sourceOf = sql<string>`coalesce(${userAttribution.snapshot}->>'source', ${NO_SOURCE_BUCKET})`;
const mediumOf = sql<string | null>`${userAttribution.snapshot}->>'utm_medium'`;
const campaignOf = sql<
  string | null
>`${userAttribution.snapshot}->>'utm_campaign'`;

/** 线索来源：从线索快照里取 source，和归因报告的 sourceOf 口径一致（含合成桶）。 */
const leadSourceOf = sql<string>`coalesce(${leads.snapshot}->>'source', ${NO_SOURCE_BUCKET})`;

export type ReportFilters = {
  source?: string;
  medium?: string;
  campaign?: string;
};

/**
 * 解析 ?source= / ?medium= / ?campaign=：只接受能写进快照的取值（见 context.ts 的
 * 校验规则），其他值一律当作没传，不把它们带进查询。source 额外接受合成桶 ——
 * 它是表格里会出现的一行，筛选框必须能选它。
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
  const sourceValue = z.union([sourceField, z.literal(NO_SOURCE_BUCKET)]);
  return {
    source: pick(sourceValue, query.source),
    medium: pick(campaignField, query.medium),
    campaign: pick(campaignField, query.campaign),
  };
}

export type Money = { currency: string | null; amount: number };

export type ReportRow = {
  /** 标签里的 NO_SOURCE_BUCKET 是没有可用归因那一段；取值本身不是快照里的来源。 */
  source: string;
  registrations: number;
  /** 付费人数：区间内有净收入为正的订单的用户数，和 /admin/metrics 同一口径。 */
  payingUsers: number;
  /** 该渠道已确认的线索数（status = 'confirmed'）。撤销/删除会导致历史指标变化。 */
  confirmedLeads: number;
  /** 注册转化率：confirmedLeads / registrations，百分数。未确认线索不计入分母。 */
  conversionRate: number | null;
  /** 净收入：区间内计入收入的订单金额减去这些订单截至查询时的累计退款，按币种。 */
  revenue: Money[];
  /**
   * 待核对：状态是收款、但金额未知（付款事件还没补齐）的订单，按币种列出这些订单
   * 已经退掉的金额 —— 金额不可信，所以既不算收入也不算付费人数，单列在这里人工核对。
   * 金额未知且还没有退款的订单列 0：那表示「还没有退款」，不表示这笔订单已经结清。
   */
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
  confirmedLeads,
}: {
  registrations: Counted[];
  payers: Counted[];
  revenue: Priced[];
  pending: Priced[];
  confirmedLeads: Counted[];
}): ReportRow[] {
  const rows = new Map<string, ReportRow>();
  const row = (source: string) => {
    const existing = rows.get(source) ?? {
      source,
      registrations: 0,
      payingUsers: 0,
      confirmedLeads: 0,
      conversionRate: null,
      revenue: [],
      pending: [],
    };
    rows.set(source, existing);
    return existing;
  };
  for (const item of registrations) row(item.source).registrations = item.value;
  for (const item of payers) row(item.source).payingUsers = item.value;
  for (const item of confirmedLeads)
    row(item.source).confirmedLeads = item.value;
  // 计算转化率：已确认线索 / 注册数。未确认线索不计入分母。
  for (const [, entry] of rows) {
    entry.conversionRate =
      entry.registrations > 0
        ? Math.round((entry.confirmedLeads / entry.registrations) * 1000) / 10
        : null;
  }
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

/** 三个筛选都用快照字段上的表达式；source 也能筛合成桶（见 parseReportFilters）。 */
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
 * 收入与付费人数用 /admin/metrics 的同一份口径（recognizedOrder / orderNet /
 * hasPositiveNet），两页在同一区间上给出相同的数字。金额未知的占位订单（退款先到、
 * 付款事件还没补齐）不进收入、也不算付费人数，只进待核对 —— 混进收入会把它当成
 * 零退款，净收入变成负数。
 */
export async function getAcquisitionReport(
  db: Database,
  window: MetricWindow,
  filters: ReportFilters = {},
): Promise<ReportRow[]> {
  const where = filterWhere(filters);
  const recognized = and(
    gte(orders.createdAt, window.since),
    ...recognizedOrder,
    ...where,
  );
  const leadWhere: SQL[] = [];
  if (filters.source) leadWhere.push(sql`${leadSourceOf} = ${filters.source}`);
  const [registrations, payers, revenue, pending, confirmedLeads] =
    await Promise.all([
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
        .where(and(recognized, hasPositiveNet))
        .groupBy(sql`1`),
      db
        .select({
          source: sourceOf,
          currency: orders.currency,
          value: sumAmounts(orderNet),
        })
        .from(orders)
        .leftJoin(userAttribution, eq(userAttribution.userId, orders.userId))
        .where(recognized)
        .groupBy(sql`1`, orders.currency),
      // 待核对：金额未知的收款订单都在这里，不管退款到没到（退款先到的是主力情形，
      // 「付款事件还没补齐、也没有退款」的订单列 0，见 ReportRow 的说明）。
      db
        .select({
          source: sourceOf,
          currency: orders.currency,
          value: sumAmounts(orders.refundedAmount),
        })
        .from(orders)
        .leftJoin(userAttribution, eq(userAttribution.userId, orders.userId))
        .where(
          and(
            gte(orders.createdAt, window.since),
            inArray(orders.status, collectedStatuses),
            isNull(orders.amount),
            ...where,
          ),
        )
        .groupBy(sql`1`, orders.currency),
      // 已确认线索数：按线索自身快照里的 source 分组，和归因报表共用同样的 source 筛选。
      db
        .select({ source: leadSourceOf, value: count() })
        .from(leads)
        .where(
          and(
            eq(leads.status, "confirmed"),
            gte(leads.createdAt, window.since),
            ...leadWhere,
          ),
        )
        .groupBy(sql`1`),
    ]);
  const amounts = <T extends { value: string }>(rows: T[]) =>
    rows.map((row) => ({ ...row, value: toAmount(row.value) }));
  return mergeRows({
    registrations,
    payers,
    confirmedLeads,
    revenue: amounts(revenue),
    pending: amounts(pending),
  });
}

export type FilterOptions = {
  sources: string[];
  mediums: string[];
  campaigns: string[];
};

/**
 * 筛选框里的取值：表格里会出现的来源都要选得到。注册那一列来自用户（含没有归因行
 * 的合成桶），已确认线索那一列来自线索快照，只从 user_attribution 取会漏掉前两者。
 * medium / campaign 只在快照里出现过的取值里选。
 *
 * 取值变化很慢（只在有新注册或线索状态变更时变），用 60s 模块级 TTL 避免默认视图
 * 每次渲染都跑 4 条全表查询。模块级缓存在所有部署环境都工作，不依赖特定框架 API。
 */
const _FILTER_OPTIONS_TTL_MS = 60_000;
let _filterOptionsCache: { data: FilterOptions; ts: number } | null = null;

async function _getFilterOptions(db: Database): Promise<FilterOptions> {
  const [sources, leadSources, mediums, campaigns] = await Promise.all([
    // select distinct，不用 group by：合成桶是绑定参数，同一个表达式在 select 和
    // group by 里会渲染成两个不同的位置参数，Postgres 不认它们相等（42803）。
    db
      .selectDistinct({ value: sourceOf })
      .from(user)
      .leftJoin(userAttribution, eq(userAttribution.userId, user.id)),
    db
      .selectDistinct({ value: leadSourceOf })
      .from(leads)
      .where(eq(leads.status, "confirmed")),
    db
      .selectDistinct({ value: mediumOf })
      .from(userAttribution)
      .where(isNotNull(mediumOf)),
    db
      .selectDistinct({ value: campaignOf })
      .from(userAttribution)
      .where(isNotNull(campaignOf)),
  ]);
  const unique = (rows: { value: string | null }[]) =>
    [
      ...new Set(
        rows.flatMap((entry) => (entry.value === null ? [] : [entry.value])),
      ),
    ].sort((a, b) => a.localeCompare(b));
  return {
    sources: unique([...sources, ...leadSources]),
    mediums: unique(mediums),
    campaigns: unique(campaigns),
  };
}

/** 带 60s TTL 的模块级缓存，避免默认视图每次渲染都跑 4 条全表查询。 */
export async function getFilterOptions(db: Database): Promise<FilterOptions> {
  if (process.env.NODE_ENV === "test" || process.env.CI) return _getFilterOptions(db);
  if (
    _filterOptionsCache &&
    Date.now() - _filterOptionsCache.ts < _FILTER_OPTIONS_TTL_MS
  ) {
    return _filterOptionsCache.data;
  }
  const data = await _getFilterOptions(db);
  _filterOptionsCache = { data, ts: Date.now() };
  return data;
}
