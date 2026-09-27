import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { adminMetadata } from "@/core/admin/metadata";
import { requireAdmin } from "@/core/admin/session";
import { EmptyRow } from "@/core/admin/ui/list";
import { MetricSection } from "@/core/admin/ui/metrics";
import { flagDefinitions, flagsEnabled } from "@/core/flags/evaluate";
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

type Props = PageProps<"/[locale]/admin/flags">;

export function generateMetadata({ params }: Props) {
  return adminMetadata(params, "/admin/flags", (t) => t("flags.title"));
}

/**
 * 用户面 flag 的定义清单。v1 是纯配置驱动：flag 状态在 `site.config.ts` 里，
 * 是构建期常量，所以这里只读 —— 运行时改写配置等于要一个 DB 里的 flag 表（见卡片「不做」）。
 * 总开关关着时和别的模块一样 404；非管理员由 requireAdmin 拦成 404。
 */
export default async function AdminFlagsPage({ params }: Props) {
  if (!flagsEnabled()) notFound();
  await requireAdmin();
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Admin.flags" });
  const flags = flagDefinitions();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("description")} />
      <MetricSection
        title={t("list.title")}
        description={t("list.description")}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.name")}</TableHead>
              <TableHead>{t("columns.description")}</TableHead>
              <TableHead>{t("columns.status")}</TableHead>
              <TableHead className="text-right">
                {t("columns.rollout")}
              </TableHead>
              <TableHead>{t("columns.access")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {flags.length === 0 && <EmptyRow colSpan={5} text={t("empty")} />}
            {flags.map(({ name, definition }) => (
              <TableRow key={name}>
                <TableCell className="font-mono text-xs">{name}</TableCell>
                <TableCell className="text-muted-foreground max-w-80">
                  {definition.description}
                </TableCell>
                <TableCell>
                  {definition.enabled ? (
                    <Badge variant="secondary">{t("status.on")}</Badge>
                  ) : (
                    <Badge variant="outline">{t("status.off")}</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {t("rollout", { percent: definition.rollout })}
                </TableCell>
                <TableCell>
                  {definition.adminOnly ? (
                    // 只有自己人看得见是个需要留意一眼的状态，给品牌芯片；其余用弱文字。
                    <Badge variant="band" flat>
                      {t("access.admins")}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">
                      {t("access.everyone")}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {/* 后台改不了配置：改完 site.config.ts 要重新部署，这里把这件事说清楚。 */}
        <p className="text-muted-foreground text-xs">{t("configHint")}</p>
      </MetricSection>
    </div>
  );
}
