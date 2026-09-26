import { getFormatter, getTranslations } from "next-intl/server";

import { adminMetadata } from "@/core/admin/metadata";
import { planLabel } from "@/core/admin/plan-name";
import { listOrders, parseOrderStatus, parsePage } from "@/core/admin/queries";
import { requireAdmin } from "@/core/admin/session";
import { EmptyRow, Pagination, StatusFilter } from "@/core/admin/ui/list";
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
 * 状态色只标异常。paid 是绝大多数行，用中性填充；退款和失败才值得一眼看见。
 * 之前只有 paid 特殊（secondary）、其余全落 outline，refunded 和 failed 分不出来。
 * 全部 `flat`：产品语域没有唇边（见 docs/design.md 的两个语域）。
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

  const t = await getTranslations({ locale, namespace: "Admin" });
  const tp = await getTranslations({ locale, namespace: "Landing.pricing" });
  const format = await getFormatter({ locale });
  const data = await listOrders(getDb(), { status, page });
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
            <EmptyRow colSpan={6} text={t("orders.empty")} />
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
