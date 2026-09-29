import { getFormatter, getTranslations } from "next-intl/server";

import { adminMetadata } from "@/core/admin/metadata";
import { planLabel } from "@/core/admin/plan-name";
import { listOrders, parseOrderStatus } from "@/core/admin/queries";
import { parsePage } from "@/core/lib/pagination";
import { requireAdmin } from "@/core/admin/session";
import { EmptyRow, Pagination, StatusFilter } from "@/core/ui/list";
import { orderStatuses, type OrderStatus } from "@/core/db/schema";
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

type Props = PageProps<"/[locale]/admin/orders">;

/**
 * Status colors mark only exceptions. paid is the vast majority of rows, so it gets a neutral fill;
 * only refunds and failures deserve to stand out at a glance. Previously only paid was special
 * (secondary) and everything else fell to outline, so refunded and failed looked the same. All
 * `flat`: the product register has no lips (see the two registers in docs/design.md).
 */
const statusVariant = {
  paid: "secondary",
  partially_refunded: "warning",
  refunded: "info",
  failed: "destructive-band",
} as const satisfies Record<OrderStatus, string>;

export function generateMetadata({ params }: Props) {
  return adminMetadata(params, "/admin/orders", (t) => t("orders.title"));
}

export default async function AdminOrdersPage({ params, searchParams }: Props) {
  await requireAdmin();
  const { locale } = await params;
  const search = await searchParams;
  const status = parseOrderStatus(search.status);
  const page = parsePage(search.page);

  // Messages, formatters and the list query don't depend on each other, so fire them concurrently.
  const [t, tp, format, data] = await Promise.all([
    getTranslations({ locale, namespace: "Admin" }),
    getTranslations({ locale, namespace: "Landing.pricing" }),
    getFormatter({ locale }),
    listOrders(getDb(), { status, page }),
  ]);
  const money = (amount: number, currency: string | null) =>
    currency
      ? format.number(amount / 100, { style: "currency", currency })
      : format.number(amount / 100);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("orders.title")}
        description={t("orders.description")}
      />
      <StatusFilter
        pathname="/admin/orders"
        statuses={orderStatuses}
        current={status}
        label={(value) => t(`orderStatus.${value}`)}
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("orders.columns.date")}</TableHead>
            <TableHead>{t("orders.columns.user")}</TableHead>
            <TableHead>{t("orders.columns.plan")}</TableHead>
            <TableHead className="text-right">
              {t("orders.columns.amount")}
            </TableHead>
            <TableHead>{t("orders.columns.status")}</TableHead>
            <TableHead>{t("orders.columns.reference")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.rows.length === 0 && (
            <EmptyRow
              colSpan={6}
              text={t("orders.empty")}
              filtered={status ? { pathname: "/admin/orders" } : undefined}
            />
          )}
          {data.rows.map((order) => (
            <TableRow key={order.id}>
              <TableCell className="text-muted-foreground">
                {format.dateTime(order.createdAt, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </TableCell>
              <TableCell className="max-w-56">
                <Link
                  href={`/admin/users/${order.userId}`}
                  className="hover:text-primary-text block truncate"
                >
                  {order.email}
                </Link>
              </TableCell>
              <TableCell>{planLabel(tp, order.planId)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {order.amount === null
                  ? "—"
                  : money(order.amount, order.currency)}
                {order.refundedAmount > 0 && (
                  <span className="text-muted-foreground block text-xs">
                    {t("orders.refunded", {
                      amount: money(order.refundedAmount, order.currency),
                    })}
                  </span>
                )}
              </TableCell>
              <TableCell>
                <Badge variant={statusVariant[order.status]} flat>
                  {t(`orderStatus.${order.status}`)}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground max-w-48 truncate font-mono text-xs">
                {order.providerOrderId}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Pagination
        pathname="/admin/orders"
        query={{ status }}
        page={data.page}
        totalPages={data.totalPages}
        total={data.total}
      />
    </div>
  );
}
