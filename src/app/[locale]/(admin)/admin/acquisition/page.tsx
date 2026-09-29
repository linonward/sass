import { getFormatter, getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";

import { adminMetadata } from "@/core/admin/metadata";
import { metricWindow, parseRange } from "@/core/admin/metrics";
import { formatMoneyList } from "@/core/admin/money";
import { revenueEnabled } from "@/core/admin/sections";
import { requireAdmin } from "@/core/admin/session";
import { EmptyRow, cleanQuery } from "@/core/ui/list";
import { MetricSection, RangeFilter } from "@/core/admin/ui/metrics";
import {
  getAcquisitionReport,
  getFilterOptions,
  parseReportFilters,
  type Money,
} from "@/core/acquisition/report";
import { ReportFilters, sourceLabel } from "@/core/acquisition/report-filters";
import { getDb } from "@/core/db";
import { localizedPath } from "@/core/seo/urls";
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

type Props = PageProps<"/[locale]/admin/acquisition">;

/** 没有付费套餐时不出收入两列（和 /admin/metrics 的区块用同一个判定）。 */
const sections = { revenue: revenueEnabled(siteConfig.billing) };

/** 三个筛选框留空 = 全部，空值不该留在 URL 里（表单提交会带上 source=&medium=&campaign=）。 */
const filterParams = ["source", "medium", "campaign"] as const;

export function generateMetadata({ params }: Props) {
  return adminMetadata(params, "/admin/acquisition", (t) =>
    t("acquisition.title"),
  );
}

/**
 * 渠道报表：区间内按注册时冻结的来源分组，看注册、付费人数和净收入。
 *
 * 归因关闭时这里和其他获客入口一样 404（构建期常量，见 next.config.ts）；
 * 非管理员由 requireAdmin 拦成 404。统计全部直接查 Postgres，不依赖 Vercel 的浏览量。
 */
export default async function AdminAcquisitionPage({
  params,
  searchParams,
}: Props) {
  if (process.env.ACQUISITION_ATTRIBUTION !== "true") notFound();
  await requireAdmin();
  const { locale } = await params;
  const search = await searchParams;
  const range = parseRange(search.range);
  const filters = parseReportFilters(search);

  // 筛选框留空 = 全部，但表单提交会把空值写进 URL（source=&medium=&campaign=），
  // 和服务端「空串当没传」的口径不一致。这里把地址栏收成规范形式，
  // 和 RangeFilter 用 cleanQuery 拼的链接是同一份规范（同页只有一个规范 URL）。
  const param = (value: string | string[] | undefined) =>
    typeof value === "string" ? value : undefined;
  if (filterParams.some((key) => search[key] === "")) {
    const canonical = cleanQuery({
      range: param(search.range),
      source: param(search.source),
      medium: param(search.medium),
      campaign: param(search.campaign),
    });
    const query = new URLSearchParams(canonical).toString();
    redirect(
      `${localizedPath(locale, "/admin/acquisition")}${query ? `?${query}` : ""}`,
    );
  }

  // 文案、格式化和两组查询互不依赖，一次并发发出。
  const db = getDb();
  const [t, format, options, rows] = await Promise.all([
    getTranslations({ locale, namespace: "Admin.acquisition" }),
    getFormatter({ locale }),
    getFilterOptions(db),
    getAcquisitionReport(db, metricWindow(range), filters),
  ]);

  const moneyList = (list: Money[]) =>
    formatMoneyList(format, list, siteConfig.billing.currency);
  const labels = { unknown: t("unknown"), direct: t("direct") };
  const columnCount = sections.revenue ? 7 : 5;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        description={t("description", { days: range })}
      />
      {/* 时间范围和渠道筛选各占一头，窄屏靠 flex-wrap 换行。 */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <RangeFilter
          current={range}
          pathname="/admin/acquisition"
          query={filters}
        />
        <ReportFilters
          action={localizedPath(locale, "/admin/acquisition")}
          options={options}
          current={filters}
          range={range}
        />
      </div>

      <MetricSection title={t("channels.title")} description={t("sourcesHint")}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.source")}</TableHead>
              <TableHead className="text-right">
                {t("columns.registrations")}
              </TableHead>
              <TableHead className="text-right">
                {t("columns.payingUsers")}
              </TableHead>
              {sections.revenue && (
                <>
                  <TableHead className="text-right">
                    {t("columns.revenue")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("columns.pending")}
                  </TableHead>
                </>
              )}
              <TableHead className="text-right">
                {t("columns.confirmedLeads")}
              </TableHead>
              <TableHead className="text-right">
                {t("columns.conversionRate")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <EmptyRow colSpan={columnCount} text={t("empty")} />
            )}
            {rows.map((row) => (
              <TableRow key={row.source}>
                <TableCell className="max-w-56">
                  <span className="block truncate" title={row.source}>
                    {sourceLabel(row.source, labels)}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {format.number(row.registrations)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {format.number(row.payingUsers)}
                </TableCell>
                {sections.revenue && (
                  <>
                    {/* 净收入会随后续退款变化，历史区间重看时数字可能不同。 */}
                    <TableCell className="text-right tabular-nums">
                      {moneyList(row.revenue)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {moneyList(row.pending)}
                    </TableCell>
                  </>
                )}
                <TableCell className="text-right tabular-nums">
                  {format.number(row.confirmedLeads)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.conversionRate != null
                    ? `${format.number(row.conversionRate)}%`
                    : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {sections.revenue && (
          <p className="text-muted-foreground text-xs">{t("pendingHint")}</p>
        )}
        <p className="text-muted-foreground text-xs">{t("leadsHint")}</p>
      </MetricSection>
    </div>
  );
}
