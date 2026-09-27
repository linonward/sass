import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { adminMetadata } from "@/core/admin/metadata";
import { requireAdmin } from "@/core/admin/session";
import { EmptyRow } from "@/core/admin/ui/list";
import { MetricSection } from "@/core/admin/ui/metrics";
import { getDb } from "@/core/db";
import { componentLabel } from "@/core/status";
import { CreateIncidentForm, IncidentActions } from "@/core/status/admin-forms";
import { statusPageEnabled } from "@/core/status/index";
import { getStatusBoard } from "@/core/status/store";
import { listSubscribers } from "@/core/status/subscribers";
import { Badge } from "@/core/ui/badge";
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

type Props = PageProps<"/[locale]/admin/status">;

export function generateMetadata({ params }: Props) {
  return adminMetadata(params, "/admin/status", (t) => t("statusPage.title"));
}

/**
 * 状态页的后台：开 / 改 / 恢复 incident，外加订阅者名单。
 *
 * 非管理员由 requireAdmin 拦成 404（不暴露后台的存在）；`statusPage.enabled` 关闭时
 * 整个页面 404，菜单里也不会出现入口。
 */
export default async function AdminStatusPage({ params }: Props) {
  if (!statusPageEnabled) notFound();
  await requireAdmin();
  const { locale } = await params;
  const config = siteConfig.statusPage;

  const db = getDb();
  // 文案、格式化和两组查询互不依赖，一次并发发出。
  const [t, tStatus, format, board, subscribers] = await Promise.all([
    getTranslations({ locale, namespace: "Admin.statusPage" }),
    // 影响级别的名字和状态页上的徽章共用一处文案（`Status.statusLabel`）。
    getTranslations({ locale, namespace: "Status" }),
    getFormatter({ locale }),
    getStatusBoard(db, config),
    listSubscribers(db),
  ]);

  const components = Object.entries(config.components).map(([key, value]) => ({
    key,
    label: value.label,
  }));
  const label = (component: string) =>
    componentLabel(config.components, component);
  const open = board.incidents.filter((incident) => !incident.resolvedAt);

  // 库里存的是 UTC 墙钟，按 UTC 显示：服务端不能拿自己的时区当默认值。
  const date = (value: Date) =>
    format.dateTime(value, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    });
  const statusBadge = (
    status: (typeof board.components)[number]["status"]["status"],
  ) => (
    <Badge
      variant={
        status === "outage"
          ? "destructive-band"
          : status === "degraded"
            ? "warning"
            : "band"
      }
      flat
    >
      {tStatus(`statusLabel.${status}`)}
    </Badge>
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={t("title")} description={t("description")} />

      <MetricSection title={t("create.title")} description={t("create.hint")}>
        <div className="panel p-4 sm:p-5">
          <CreateIncidentForm components={components} />
        </div>
      </MetricSection>

      <MetricSection title={t("open.title")}>
        {open.length === 0 ? (
          <p className="panel text-muted-foreground p-8 text-center text-sm">
            {t("open.empty")}
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {open.map((incident) => (
              <li key={incident.id} className="panel space-y-4 p-4 sm:p-5">
                <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  {statusBadge(incident.status)}
                  <span className="text-foreground font-medium">
                    {label(incident.component)}
                  </span>
                  <time dateTime={incident.createdAt.toISOString()}>
                    {date(incident.createdAt)}
                  </time>
                  {incident.source === "auto" && (
                    <span className="text-xs">{t("auto")}</span>
                  )}
                </div>
                <p className="text-sm text-pretty">{incident.message}</p>
                <IncidentActions
                  incident={{
                    id: incident.id,
                    status: incident.status,
                    message: incident.message,
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </MetricSection>

      <MetricSection
        title={t("history.title")}
        description={t("history.description", { days: config.historyDays })}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.component")}</TableHead>
              <TableHead>{t("columns.status")}</TableHead>
              <TableHead>{t("columns.createdAt")}</TableHead>
              <TableHead>{t("columns.message")}</TableHead>
              <TableHead>{t("columns.resolvedAt")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {board.incidents.length === 0 && (
              <EmptyRow colSpan={5} text={t("history.empty")} />
            )}
            {board.incidents.map((incident) => (
              <TableRow key={incident.id}>
                <TableCell>{label(incident.component)}</TableCell>
                <TableCell>{statusBadge(incident.status)}</TableCell>
                <TableCell className="text-muted-foreground whitespace-nowrap">
                  {date(incident.createdAt)}
                </TableCell>
                <TableCell className="max-w-96">
                  <span className="block truncate" title={incident.message}>
                    {incident.message}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground whitespace-nowrap">
                  {incident.resolvedAt
                    ? date(incident.resolvedAt)
                    : t("ongoing")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </MetricSection>

      <MetricSection
        title={t("subscribers.title")}
        description={t("subscribers.description", {
          count: subscribers.length,
        })}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("subscribers.email")}</TableHead>
              <TableHead>{t("subscribers.state")}</TableHead>
              <TableHead>{t("subscribers.createdAt")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {subscribers.length === 0 && (
              <EmptyRow colSpan={3} text={t("subscribers.empty")} />
            )}
            {subscribers.map((subscriber) => (
              <TableRow key={subscriber.email}>
                <TableCell className="max-w-72">
                  <span className="block truncate" title={subscriber.email}>
                    {subscriber.email}
                  </span>
                </TableCell>
                <TableCell>
                  {subscriber.confirmedAt ? (
                    <Badge variant="band" flat>
                      {t("subscribers.confirmed")}
                    </Badge>
                  ) : (
                    <Badge variant="secondary">
                      {t("subscribers.pending")}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground whitespace-nowrap">
                  {date(subscriber.createdAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </MetricSection>
    </div>
  );
}
