import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { adminMetadata } from "@/core/admin/metadata";
import {
  leadStatuses,
  listLeads,
  parseLeadStatus,
  type LeadRow,
  type LeadStatus,
} from "@/core/admin/leads-queries";
import { parsePage } from "@/core/lib/pagination";
import { requireAdmin } from "@/core/admin/session";
import { EmptyRow, Pagination, StatusFilter } from "@/core/ui/list";
import { getDb } from "@/core/db";
import { localizedPath } from "@/core/seo/urls";
import { Badge } from "@/core/ui/badge";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { PageHeader } from "@/core/ui/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/core/ui/table";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    status?: string | string[];
    email?: string | string[];
    page?: string | string[];
  }>;
};

export function generateMetadata({ params }: Props) {
  return adminMetadata(params, "/admin/leads", (t) => t("leads.title"));
}

function LeadStatusBadge({
  status,
  label,
}: {
  status: LeadStatus;
  label: string;
}) {
  if (status === "withdrawn") {
    return (
      <Badge variant="destructive-band" flat>
        {label}
      </Badge>
    );
  }
  if (status === "confirmed") {
    return <Badge variant="secondary">{label}</Badge>;
  }
  return <Badge variant="outline">{label}</Badge>;
}

export default async function AdminLeadsPage({ params, searchParams }: Props) {
  if (process.env.ACQUISITION_LEADS !== "true") notFound();
  await requireAdmin();
  const { locale } = await params;
  const search = await searchParams;
  const status = parseLeadStatus(search.status);
  const email = typeof search.email === "string" ? search.email : "";
  const page = parsePage(search.page);

  const [t, format, data] = await Promise.all([
    getTranslations({ locale, namespace: "Admin.leads" }),
    getFormatter({ locale }),
    listLeads(getDb(), { status, email, page }),
  ]);

  const statusLabel = (s: LeadStatus) =>
    t(`status.${s}` as Parameters<typeof t>[0]);

  const exportParams = new URLSearchParams();
  if (status) exportParams.set("status", status);
  if (email) exportParams.set("email", email);

  const sourceLabel = (row: LeadRow) => row.source ?? t("unknownSource");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("description")} />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <StatusFilter
          pathname={localizedPath(locale, "/admin/leads")}
          statuses={leadStatuses}
          current={status}
          label={statusLabel}
        />
        <div className="flex gap-2">
          <form
            action={localizedPath(locale, "/admin/leads")}
            role="search"
            className="flex gap-2"
          >
            <Input
              name="email"
              type="search"
              defaultValue={email}
              aria-label={t("searchEmail")}
              placeholder={t("searchEmail")}
            />
            <Button type="submit" variant="outline">
              {t("searchButton")}
            </Button>
          </form>
          <a
            href={`/api/admin/leads/export?${exportParams.toString()}`}
            className="inline-flex items-center"
          >
            <Button type="button" variant="outline">
              {t("exportCsv")}
            </Button>
          </a>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("columns.email")}</TableHead>
            <TableHead>{t("columns.status")}</TableHead>
            <TableHead>{t("columns.list")}</TableHead>
            <TableHead>{t("columns.source")}</TableHead>
            <TableHead>{t("columns.created")}</TableHead>
            <TableHead>{t("columns.confirmed")}</TableHead>
            <TableHead>{t("columns.user")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.rows.length === 0 && (
            <EmptyRow
              colSpan={7}
              text={t("empty")}
              filtered={
                status || email ? { pathname: "/admin/leads" } : undefined
              }
            />
          )}
          {data.rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="max-w-48">
                <span className="block truncate" title={row.email ?? undefined}>
                  {row.email ?? "—"}
                </span>
              </TableCell>
              <TableCell>
                <LeadStatusBadge
                  status={row.status}
                  label={statusLabel(row.status)}
                />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {row.listId}
              </TableCell>
              <TableCell className="max-w-40">
                <span className="block truncate" title={sourceLabel(row)}>
                  {sourceLabel(row)}
                </span>
              </TableCell>
              <TableCell className="text-muted-foreground tabular-nums">
                {format.dateTime(row.createdAt, {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </TableCell>
              <TableCell className="text-muted-foreground tabular-nums">
                {row.confirmedAt
                  ? format.dateTime(row.confirmedAt, {
                      dateStyle: "short",
                      timeStyle: "short",
                    })
                  : "—"}
              </TableCell>
              <TableCell>
                {row.userEmail ? (
                  <span className="text-muted-foreground text-sm">
                    {row.userEmail}
                  </span>
                ) : (
                  "—"
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Pagination
        pathname={localizedPath(locale, "/admin/leads")}
        query={{ status, email: email || undefined }}
        page={data.page}
        totalPages={data.totalPages}
        total={data.total}
      />
    </div>
  );
}
