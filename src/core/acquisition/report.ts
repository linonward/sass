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

// Channel report aggregation for /admin/acquisition. The time basis reuses /admin/metrics
// directly: UTC half-open ranges of 7 / 30 / 90 days. The revenue basis is shared with
// /admin/metrics as well (see "revenue basis" at the top of metrics.ts; the buyer-facing
// explanation is the revenue basis section of the README): revenue is attributed to the **order's
// period** (orders created within the range), and refunds are deducted at their cumulative value as
// of query time, so historical ranges change as later refunds come in.

/**
 * Synthetic bucket for "no usable attribution". Users with no attribution row (existing users who
 * signed up before the feature was on, cross-device) and withdrawn ones (null snapshot) both land
 * here. The value is deliberately a string that can never appear in a snapshot (parentheses aren't
 * in context.ts's allowed character set), so traffic that really sets utm_source to `unknown` gets
 * **its own row** and never mixes with "no attribution"; both values also show up in the filter.
 */
export const NO_SOURCE_BUCKET = "(none)";

/**
 * The frozen source (source in the snapshot). direct means there really was no source, and it's a
 * separate row from NO_SOURCE_BUCKET.
 */
const sourceOf = sql<string>`coalesce(${userAttribution.snapshot}->>'source', ${NO_SOURCE_BUCKET})`;
const mediumOf = sql<string | null>`${userAttribution.snapshot}->>'utm_medium'`;
const campaignOf = sql<
  string | null
>`${userAttribution.snapshot}->>'utm_campaign'`;

/**
 * Lead source: source from the lead's snapshot, on the same basis as the attribution report's
 * sourceOf (including the synthetic bucket).
 */
const leadSourceOf = sql<string>`coalesce(${leads.snapshot}->>'source', ${NO_SOURCE_BUCKET})`;

export type ReportFilters = {
  source?: string;
  medium?: string;
  campaign?: string;
};

/**
 * Parses ?source= / ?medium= / ?campaign=: only values that could be written into a snapshot are
 * accepted (see the validation rules in context.ts); anything else is treated as absent and never
 * reaches the query. source also accepts the synthetic bucket — it's a row that shows up in the
 * table, so the filter must be able to select it.
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
  /**
   * NO_SOURCE_BUCKET here is the segment with no usable attribution; the value itself is not a
   * source from any snapshot.
   */
  source: string;
  registrations: number;
  /**
   * Paying users: users with an order in the range whose net revenue is positive, on the same basis
   * as /admin/metrics.
   */
  payingUsers: number;
  /**
   * Confirmed leads for this channel (status = 'confirmed'). Withdrawals / deletions change
   * historical numbers.
   */
  confirmedLeads: number;
  /**
   * Conversion rate: confirmedLeads / registrations, as a percentage. Unconfirmed leads aren't part
   * of the denominator.
   */
  conversionRate: number | null;
  /**
   * Net revenue: the amount of orders in the range that count as revenue, minus those orders'
   * cumulative refunds as of query time, per currency.
   */
  revenue: Money[];
  /**
   * Needs reconciling: orders in a collected status whose amount is unknown (the payment event
   * hasn't been backfilled yet), listing per currency how much of them has already been refunded
   * — the amount can't be trusted, so these count as neither revenue nor paying users and are
   * listed separately here for manual reconciliation. An order with an unknown amount and no refund
   * yet shows 0: that means "no refund yet", not that the order is settled.
   */
  pending: Money[];
};

type Counted = { source: string; value: number };
type Priced = Counted & { currency: string | null };

/**
 * Merges the aggregates into one row per source: a source that appears in any of them gets a row,
 * and missing values are 0. Currencies with zero net revenue are omitted (a fully refunded order
 * shouldn't show up as a "0" line); needs-reconciling amounts are listed as is.
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
  // Conversion rate: confirmed leads / registrations. Unconfirmed leads aren't in the denominator.
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

/**
 * All three filters use expressions on snapshot fields; source can also filter on the synthetic
 * bucket (see parseReportFilters).
 */
function filterWhere(filters: ReportFilters) {
  const clauses: SQL[] = [];
  if (filters.source) clauses.push(sql`${sourceOf} = ${filters.source}`);
  if (filters.medium) clauses.push(sql`${mediumOf} = ${filters.medium}`);
  if (filters.campaign) clauses.push(sql`${campaignOf} = ${filters.campaign}`);
  return clauses;
}

/**
 * Registrations, paying users, net revenue per currency, and refunds needing reconciliation within
 * the range, grouped by frozen source.
 *
 * Revenue and paying users use exactly the same basis as /admin/metrics (recognizedOrder /
 * orderNet / hasPositiveNet), so both pages give the same numbers for the same range. Placeholder
 * orders with an unknown amount (the refund arrived first and the payment event hasn't been
 * backfilled) count as neither revenue nor paying users and only go into needs-reconciling — mixed
 * into revenue they would be treated as zero minus the refund and turn net revenue negative.
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
      // Needs reconciling: every collected order with an unknown amount lands here, whether or not
      // a refund has arrived (refund-first is the main case; an order whose payment event hasn't
      // been backfilled and that has no refund shows 0, see the ReportRow docs).
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
      // Confirmed leads: grouped by source in the lead's own snapshot, sharing the same source
      // filter as the attribution report.
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
 * Filter options: every source that can appear in the table must be selectable. The registrations
 * column comes from users (including the synthetic bucket for users without an attribution row) and
 * the confirmed leads column comes from lead snapshots; reading only user_attribution would miss
 * both. medium / campaign only offer values that have appeared in snapshots.
 *
 * The values change slowly (only on new sign-ups or lead status changes), so a 60s module-level TTL
 * keeps the default view from running 4 full-table queries on every render. A module-level cache
 * works in every deployment environment and doesn't depend on any framework-specific API.
 */
const _FILTER_OPTIONS_TTL_MS = 60_000;
let _filterOptionsCache: { data: FilterOptions; ts: number } | null = null;

async function _getFilterOptions(db: Database): Promise<FilterOptions> {
  const [sources, leadSources, mediums, campaigns] = await Promise.all([
    // select distinct, not group by: the synthetic bucket is a bound parameter, so the same
    // expression renders as two different positional parameters in select and group by, and
    // Postgres doesn't consider them equal (42803).
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

/**
 * Module-level cache with a 60s TTL, so the default view doesn't run 4 full-table queries on every
 * render.
 */
export async function getFilterOptions(db: Database): Promise<FilterOptions> {
  if (process.env.NODE_ENV === "test" || process.env.CI)
    return _getFilterOptions(db);
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
