import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { adminMetadata } from "@/core/admin/metadata";
import { parsePage } from "@/core/admin/queries";
import { requireAdmin } from "@/core/admin/session";
import { EmptyRow, Pagination, StatusFilter } from "@/core/admin/ui/list";
import {
  createReferralService,
  type ReferralStatus,
} from "@/core/acquisition/referrals/service";
import { getDb } from "@/core/db";
import { localizedPath } from "@/core/seo/urls";
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

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    status?: string | string[];
    page?: string | string[];
  }>;
};

const referralStatuses: readonly ReferralStatus[] = [
  "awaiting_payment",
  "rewarded",
  "revoked",
  "pending_review",
];

function parseReferralStatus(value: unknown): ReferralStatus | undefined {
  return referralStatuses.includes(value as ReferralStatus)
    ? (value as ReferralStatus)
    : undefined;
}

export function generateMetadata({ params }: Props) {
  return adminMetadata(params, "/admin/referrals", (t) => t("referrals.title"));
}

export default async function AdminReferralsPage({
  params,
  searchParams,
}: Props) {
  if (process.env.ACQUISITION_REFERRALS !== "true") notFound();
  await requireAdmin();
  const { locale } = await params;
  const search = await searchParams;
  const status = parseReferralStatus(search.status);
  const page = parsePage(search.page);

  const [t, format, data] = await Promise.all([
    getTranslations({ locale, namespace: "Admin.referrals" }),
    getFormatter({ locale }),
    createReferralService(getDb()).listAllRelationships({ status, page }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("description")} />

      <StatusFilter
        pathname={localizedPath(locale, "/admin/referrals")}
        statuses={referralStatuses}
        current={status}
        label={(s) => t(`status.${s}`)}
      />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("columns.invitee")}</TableHead>
            <TableHead>{t("columns.inviter")}</TableHead>
            <TableHead>{t("columns.code")}</TableHead>
            <TableHead>{t("columns.status")}</TableHead>
            <TableHead>{t("columns.created")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.rows.length === 0 && <EmptyRow colSpan={5} text={t("empty")} />}
          {data.rows.map((row) => (
            <TableRow key={row.inviteeUserId}>
              <TableCell className="max-w-40">
                <span className="block truncate" title={row.inviteeUserId}>
                  {row.inviteeUserId}
                </span>
              </TableCell>
              <TableCell className="max-w-40">
                <span className="block truncate" title={row.inviterUserId}>
                  {row.inviterUserId}
                </span>
              </TableCell>
              <TableCell className="font-mono text-sm">{row.code}</TableCell>
              <TableCell>
                <Badge
                  variant={
                    row.status === "rewarded"
                      ? "secondary"
                      : row.status === "revoked"
                        ? "destructive-band"
                        : "outline"
                  }
                  flat
                >
                  {t(`status.${row.status as ReferralStatus}`)}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground tabular-nums">
                {format.dateTime(row.createdAt, {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Pagination
        pathname={localizedPath(locale, "/admin/referrals")}
        query={{ status }}
        page={data.page}
        totalPages={data.totalPages}
        total={data.total}
      />
    </div>
  );
}
