import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { adminMetadata } from "@/core/admin/metadata";
import { requireAdmin } from "@/core/admin/session";
import { EmptyRow } from "@/core/ui/list";
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
 * List of user-facing feature flag definitions. v1 is purely config-driven: flag state lives in
 * `site.config.ts` as build-time constants, so this page is read-only — changing config at runtime
 * would mean a flag table in the database, which is out of scope. With the master switch off this
 * returns 404 like other modules; requireAdmin turns non-admins into a 404.
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
                    // "Visible to insiders only" is a state worth a glance, so it gets a brand chip; the rest use
                    // muted text.
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
        {/* The admin can't change config: editing site.config.ts needs a redeploy, and this says so plainly. */}
        <p className="text-muted-foreground text-xs">{t("configHint")}</p>
      </MetricSection>
    </div>
  );
}
