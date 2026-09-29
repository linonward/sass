import { getFormatter, getTranslations } from "next-intl/server";

import { adminMetadata } from "@/core/admin/metadata";
import { planLabel } from "@/core/admin/plan-name";
import {
  listSubscriptions,
  parseSubscriptionStatus,
} from "@/core/admin/queries";
import { parsePage } from "@/core/lib/pagination";
import { requireAdmin } from "@/core/admin/session";
import { EmptyRow, Pagination, StatusFilter } from "@/core/ui/list";
import {
  subscriptionStatuses,
  type SubscriptionStatus,
} from "@/core/db/schema";
import { getDb } from "@/core/db";
import { Link } from "@/core/i18n/navigation";
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

type Props = PageProps<"/[locale]/admin/subscriptions">;

/**
 * The normal state (active) uses a neutral fill; only past-due deserves a color. canceled / expired
 * mean "it ended", not an error, so they keep the muted outline treatment instead of going red.
 */
const statusVariant = {
  active: "secondary",
  past_due: "warning",
  canceled: "outline",
  expired: "outline",
} as const satisfies Record<SubscriptionStatus, string>;

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

  // Messages, formatters and the list query don't depend on each other, so fire them concurrently.
  const [t, tb, tp, format, data] = await Promise.all([
    getTranslations({ locale, namespace: "Admin" }),
    getTranslations({ locale, namespace: "Billing.page" }),
    getTranslations({ locale, namespace: "Landing.pricing" }),
    getFormatter({ locale }),
    listSubscriptions(getDb(), { status, page }),
  ]);
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
            <EmptyRow
              colSpan={6}
              text={t("subscriptions.empty")}
              filtered={
                status ? { pathname: "/admin/subscriptions" } : undefined
              }
            />
          )}
          {data.rows.map((sub) => (
            <TableRow key={sub.id}>
              <TableCell className="text-muted-foreground">
                {date(sub.createdAt)}
              </TableCell>
              <TableCell className="max-w-56">
                <Link
                  href={`/admin/users/${sub.userId}`}
                  className="hover:text-primary-text block truncate"
                >
                  {sub.email}
                </Link>
              </TableCell>
              <TableCell>{planLabel(tp, sub.planId)}</TableCell>
              <TableCell>
                <Badge variant={statusVariant[sub.status]} flat>
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
