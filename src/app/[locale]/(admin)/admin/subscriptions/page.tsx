import { getFormatter, getTranslations } from "next-intl/server";

import { adminMetadata } from "@/core/admin/metadata";
import { planLabel } from "@/core/admin/plan-name";
import {
  listSubscriptions,
  parsePage,
  parseSubscriptionStatus,
} from "@/core/admin/queries";
import { requireAdmin } from "@/core/admin/session";
import {
  EmptyRow,
  PageHeader,
  Pagination,
  StatusFilter,
} from "@/core/admin/ui/list";
import { subscriptionStatuses } from "@/core/db/schema";
import { getDb } from "@/core/db";
import { Link } from "@/core/i18n/navigation";
import { Badge } from "@/core/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/core/ui/table";

type Props = PageProps<"/[locale]/admin/subscriptions">;

export function generateMetadata({ params }: Props) {
  return adminMetadata(params, "/admin/subscriptions", (t) =>
    t("subscriptions.title"),
  );
}

export default async function AdminSubscriptionsPage({
  params,
  searchParams,
}: Props) {
  await requireAdmin();
  const { locale } = await params;
  const search = await searchParams;
  const status = parseSubscriptionStatus(search.status);
  const page = parsePage(search.page);

  const t = await getTranslations({ locale, namespace: "Admin" });
  const tb = await getTranslations({ locale, namespace: "Billing.page" });
  const tp = await getTranslations({ locale, namespace: "Landing.pricing" });
  const format = await getFormatter({ locale });
  const data = await listSubscriptions(getDb(), { status, page });
  const date = (value: Date | null) =>
    value ? format.dateTime(value, { dateStyle: "medium" }) : "—";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("subscriptions.title")}
        description={t("subscriptions.description")}
      />
      <StatusFilter
        pathname="/admin/subscriptions"
        statuses={subscriptionStatuses}
        current={status}
        label={(value) => tb(`status.${value}`)}
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("subscriptions.columns.created")}</TableHead>
            <TableHead>{t("subscriptions.columns.user")}</TableHead>
            <TableHead>{t("subscriptions.columns.plan")}</TableHead>
            <TableHead>{t("subscriptions.columns.status")}</TableHead>
            <TableHead>{t("subscriptions.columns.periodEnd")}</TableHead>
            <TableHead>{t("subscriptions.columns.reference")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.rows.length === 0 && (
            <EmptyRow colSpan={6} text={t("subscriptions.empty")} />
          )}
          {data.rows.map((sub) => (
            <TableRow key={sub.id}>
              <TableCell className="text-muted-foreground">
                {date(sub.createdAt)}
              </TableCell>
              <TableCell className="max-w-56">
                <Link
                  href={`/admin/users/${sub.userId}`}
                  className="hover:text-primary block truncate"
                >
                  {sub.email}
                </Link>
              </TableCell>
              <TableCell>{planLabel(tp, sub.planId)}</TableCell>
              <TableCell>
                <Badge
                  variant={sub.status === "active" ? "secondary" : "outline"}
                >
                  {tb(`status.${sub.status}`)}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {date(sub.currentPeriodEnd)}
              </TableCell>
              <TableCell className="text-muted-foreground max-w-48 truncate font-mono text-xs">
                {sub.providerSubscriptionId}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Pagination
        pathname="/admin/subscriptions"
        query={{ status }}
        page={data.page}
        totalPages={data.totalPages}
        total={data.total}
      />
    </div>
  );
}
