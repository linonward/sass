import { getFormatter, getTranslations } from "next-intl/server";

import { adminMetadata } from "@/core/admin/metadata";
import {
  getAiMetrics,
  getCreditMetrics,
  getRevenueMetrics,
  getUserMetrics,
  metricWindow,
  parseRange,
} from "@/core/admin/metrics";
import { requireAdmin } from "@/core/admin/session";
import { EmptyRow } from "@/core/admin/ui/list";
import {
  ChartGrid,
  DailyColumns,
  MetricSection,
  RangeFilter,
  StatGrid,
  StatTile,
} from "@/core/admin/ui/metrics";
import { getDb } from "@/core/db";
import { PageHeader } from "@/core/ui/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/core/ui/table";

import siteConfig from "../../../../../../site.config";

type Props = PageProps<"/[locale]/admin/metrics">;

// 模块关闭时对应区块不显示；没有付费套餐时不显示收入。
const sections = {
  revenue: siteConfig.billing.plans.some((plan) => plan.price > 0),
  credits: siteConfig.features.credits,
  ai: siteConfig.features.ai,
};

export function generateMetadata({ params }: Props) {
  return adminMetadata(params, "/admin/metrics", (t) => t("metrics.title"));
}

export default async function AdminMetricsPage({
  params,
  searchParams,
}: Props) {
  await requireAdmin();
  const { locale } = await params;
  const range = parseRange((await searchParams).range);
  const window = metricWindow(range);

  const db = getDb();
  const [t, format, users, revenue, credits, ai] = await Promise.all([
    getTranslations({ locale, namespace: "Admin.metrics" }),
    getFormatter({ locale }),
    getUserMetrics(db, window),
    sections.revenue
      ? getRevenueMetrics(db, window, siteConfig.billing)
      : undefined,
    sections.credits ? getCreditMetrics(db, window) : undefined,
    sections.ai ? getAiMetrics(db, window) : undefined,
  ]);

  const number = (value: number) => format.number(value);
  const money = (amount: number, currency: string) =>
    format.number(amount / 100, {
      style: "currency",
      currency,
      maximumFractionDigits: amount % 100 === 0 ? 0 : 2,
    });
  const percent = (value: number | null) =>
    value === null
      ? "—"
      : format.number(value, { style: "percent", maximumFractionDigits: 1 });
  const day = (value: string) =>
    format.dateTime(new Date(`${value}T00:00:00Z`), {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={t("title")}
        description={t("description", { days: range })}
      />
      {/* 和 orders / subscriptions 一样，筛选器自成一行，不塞进页头。 */}
      <RangeFilter current={range} />

      <MetricSection title={t("users.title")}>
        <StatGrid>
          <StatTile
            label={t("users.new")}
            value={number(users.newUsers)}
            testId="metric-new-users"
          />
          <StatTile label={t("users.total")} value={number(users.totalUsers)} />
          <StatTile
            label={t("users.banned")}
            value={number(users.bannedUsers)}
          />
        </StatGrid>
      </MetricSection>

      {revenue && (
        <MetricSection
          title={t("revenue.title")}
          description={t("revenue.description")}
        >
          <StatGrid>
            <StatTile
              label={t("revenue.net")}
              value={
                revenue.revenue.length === 0
                  ? money(0, siteConfig.billing.currency)
                  : revenue.revenue
                      .map((row) => money(row.amount, row.currency))
                      .join(" · ")
              }
              testId="metric-revenue"
            />
            <StatTile
              label={t("revenue.mrr")}
              value={money(revenue.mrr.amount, revenue.mrr.currency)}
              hint={
                revenue.unpricedSubscriptions > 0
                  ? t("revenue.unpriced", {
                      count: revenue.unpricedSubscriptions,
                    })
                  : t("revenue.mrrHint")
              }
            />
            <StatTile
              label={t("revenue.activeSubscriptions")}
              value={number(revenue.activeSubscriptions)}
            />
            <StatTile
              label={t("revenue.payingUsers")}
              value={number(revenue.payingUsers)}
            />
          </StatGrid>
        </MetricSection>
      )}

      <ChartGrid>
        <DailyColumns
          title={t("users.daily")}
          points={users.daily}
          formatValue={number}
          formatDay={day}
        />
        {revenue && (
          <DailyColumns
            title={t("revenue.daily", {
              currency: siteConfig.billing.currency,
            })}
            points={revenue.daily}
            formatValue={(value) => money(value, siteConfig.billing.currency)}
            formatDay={day}
          />
        )}
      </ChartGrid>

      {credits && (
        <MetricSection title={t("credits.title")}>
          <StatGrid>
            <StatTile
              label={t("credits.granted")}
              value={number(credits.granted)}
            />
            <StatTile
              label={t("credits.consumed")}
              value={number(credits.consumed)}
            />
            <StatTile
              label={t("credits.refunded")}
              value={number(credits.refunded)}
            />
          </StatGrid>
        </MetricSection>
      )}

      {ai && (
        <MetricSection title={t("ai.title")} description={t("ai.description")}>
          <StatGrid>
            <StatTile label={t("ai.calls")} value={number(ai.calls)} />
            <StatTile
              label={t("ai.failureRate")}
              value={percent(ai.failureRate)}
            />
          </StatGrid>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("ai.columns.kind")}</TableHead>
                <TableHead>{t("ai.columns.model")}</TableHead>
                <TableHead className="text-right">
                  {t("ai.columns.calls")}
                </TableHead>
                <TableHead className="text-right">
                  {t("ai.columns.failed")}
                </TableHead>
                <TableHead className="text-right">
                  {t("ai.columns.failureRate")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ai.models.length === 0 && (
                <EmptyRow colSpan={5} text={t("ai.empty")} />
              )}
              {ai.models.map((row) => (
                <TableRow key={`${row.kind}:${row.modelId}`}>
                  <TableCell>{t(`ai.kind.${row.kind}`)}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {row.modelId}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {number(row.calls)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {number(row.failed)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {percent(row.failureRate)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </MetricSection>
      )}
    </div>
  );
}
