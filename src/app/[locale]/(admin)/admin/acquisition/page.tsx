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

/** Hide the two revenue columns when there are no paid plans (same check as the /admin/metrics sections). */
const sections = { revenue: revenueEnabled(siteConfig.billing) };

/**
 * An empty filter box means "all", and empty values shouldn't stay in the URL (the form submit adds
 * source=&medium=&campaign=).
 */
const filterParams = ["source", "medium", "campaign"] as const;

export function generateMetadata({ params }: Props) {
  return adminMetadata(params, "/admin/acquisition", (t) =>
    t("acquisition.title"),
  );
}

/**
 * Channel report: for the selected range, group sign-ups by the source frozen at sign-up time and
 * show sign-ups, paying users and net revenue.
 *
 * With attribution off this returns 404 like the other acquisition entry points (a build-time
 * constant, see next.config.ts); requireAdmin turns non-admins into a 404. All stats are queried
 * straight from Postgres, with no dependency on Vercel page-view analytics.
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

  // An empty filter box means "all", but the form submit writes empty values into the URL
  // (source=&medium=&campaign=), which doesn't match the server treating an empty string as absent.
  // Normalize the address bar here to the same canonical form RangeFilter builds with cleanQuery
  // (one canonical URL per page).
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

  // Messages, formatters and the two queries don't depend on each other, so fire them concurrently.
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
      {/* Date range and channel filters sit at opposite ends; on narrow screens flex-wrap wraps them. */}
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
                    {/* Net revenue changes with later refunds, so revisiting a past range may show different numbers. */}
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
