import { ReceiptIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { requirePageSession } from "@/core/auth/session";
import { getDb } from "@/core/db";
import { parsePage } from "@/core/lib/pagination";
import { buildMetadata } from "@/core/seo/metadata";
import { Badge } from "@/core/ui/badge";
import { EmptyRow, ListToolbar, Pagination } from "@/core/ui/list";
import { PageHeader } from "@/core/ui/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/core/ui/table";

import {
  CreateInvoiceDialog,
  DeleteInvoiceDialog,
  EditInvoiceDialog,
} from "./dialogs";
import { listInvoices } from "./queries";
import type { InvoiceStatus } from "./schema";

import siteConfig from "../../../site.config";

// 示例业务模块的列表页：分页、按客户名搜索、新建 / 编辑 / 删除。
// 路由文件 src/app/[locale]/(app)/invoices/page.tsx 只是转发到这里；
// 删除这个示例的清单见 ./schema.ts 末尾。

type Props = PageProps<"/[locale]/invoices">;

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Invoices" });
  return buildMetadata({
    locale,
    path: "/invoices",
    title: t("metaTitle"),
    noIndex: true,
  });
}

/**
 * 状态色只标异常：`sent`（等收款）是唯一需要人看一眼的，其余中性。
 * `paid` 是正常态用中性填充，草稿和作废都用描边档（同 docs/design.md 的规则）。
 * 全部 `flat`：产品语域没有唇边。
 */
const statusVariant = {
  draft: "outline",
  sent: "warning",
  paid: "secondary",
  void: "outline",
} as const satisfies Record<InvoiceStatus, string>;

function StatusBadge({
  status,
  label,
}: {
  status: InvoiceStatus;
  label: string;
}) {
  return (
    <Badge variant={statusVariant[status]} flat>
      {label}
    </Badge>
  );
}

/**
 * 发票列表：只列当前登录用户自己的发票 —— 查询永远带 `user_id`（见 ./queries.ts）。
 * 金额按 site.config.ts 的 billing.currency 格式化，编辑和删除只在行上出现。
 */
export default async function InvoicesPage({ params, searchParams }: Props) {
  // 模块关掉时整页 404：页面、action、菜单项都按同一个开关收口。
  if (!siteConfig.features.examples.invoices) notFound();
  const { locale } = await params;
  const search = await searchParams;
  const query = typeof search.q === "string" ? search.q : "";
  const page = parsePage(search.page);

  // 文案、格式化和登录态互不依赖，一次并发发出。
  const [t, format, session] = await Promise.all([
    getTranslations({ locale, namespace: "Invoices" }),
    getFormatter({ locale }),
    requirePageSession(locale),
  ]);
  const data = await listInvoices(getDb(), {
    userId: session.user.id,
    query,
    page,
  });
  const money = (cents: number) =>
    format.number(cents / 100, {
      style: "currency",
      currency: siteConfig.billing.currency,
    });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("description")}>
        <CreateInvoiceDialog currency={siteConfig.billing.currency} />
      </PageHeader>
      <ListToolbar
        pathname="/invoices"
        value={query}
        label={t("search")}
        submitLabel={t("searchButton")}
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("columns.customer")}</TableHead>
            <TableHead className="text-right">{t("columns.amount")}</TableHead>
            <TableHead>{t("columns.status")}</TableHead>
            <TableHead>{t("columns.created")}</TableHead>
            <TableHead className="text-right">{t("columns.actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.rows.length === 0 && (
            <EmptyRow
              colSpan={5}
              icon={<ReceiptIcon />}
              text={t("empty")}
              filtered={
                query
                  ? { pathname: "/invoices", text: t("noResults") }
                  : undefined
              }
            />
          )}
          {data.rows.map((invoice) => (
            <TableRow key={invoice.id} data-testid="invoice-row">
              <TableCell className="font-medium" data-testid="invoice-row-name">
                {invoice.customerName}
              </TableCell>
              <TableCell className="text-right" data-numeric>
                {money(invoice.amount)}
              </TableCell>
              <TableCell data-testid="invoice-row-status">
                <StatusBadge
                  status={invoice.status}
                  label={t(`status.${invoice.status}`)}
                />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {format.dateTime(invoice.createdAt, { dateStyle: "medium" })}
              </TableCell>
              <TableCell>
                <div className="flex justify-end gap-2">
                  <EditInvoiceDialog
                    invoice={{
                      id: invoice.id,
                      customerName: invoice.customerName,
                      amount: invoice.amount,
                      status: invoice.status,
                    }}
                    currency={siteConfig.billing.currency}
                  />
                  <DeleteInvoiceDialog
                    invoice={{
                      id: invoice.id,
                      customerName: invoice.customerName,
                      amount: invoice.amount,
                      status: invoice.status,
                    }}
                  />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Pagination
        pathname="/invoices"
        query={{ q: query }}
        page={data.page}
        totalPages={data.totalPages}
        total={data.total}
      />
      <p className="text-muted-foreground text-sm text-pretty">{t("hint")}</p>
    </div>
  );
}
