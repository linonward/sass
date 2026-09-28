import { ChevronLeft, ChevronRight, ReceiptIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { requirePageSession } from "@/core/auth/session";
import { getDb } from "@/core/db";
import { Link } from "@/core/i18n/navigation";
import { cn } from "@/core/lib/utils";
import { buildMetadata } from "@/core/seo/metadata";
import { localizedPath } from "@/core/seo/urls";
import { Badge } from "@/core/ui/badge";
import { Button, buttonVariants } from "@/core/ui/button";
import { EmptyState } from "@/core/ui/empty-state";
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

import {
  CreateInvoiceDialog,
  DeleteInvoiceDialog,
  EditInvoiceDialog,
} from "./dialogs";
import { listInvoices, parsePage } from "./queries";
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

/** 只保留有值的查询参数，第 1 页不写 page。 */
function cleanQuery(query: Record<string, string | undefined>) {
  return Object.fromEntries(
    Object.entries(query).filter(
      ([key, value]) => value && !(key === "page" && value === "1"),
    ),
  ) as Record<string, string>;
}

/**
 * 上一页 / 下一页，保留搜索词。
 *
 * 抄自 core/admin/ui/list.tsx 的同名组件：业务模块去 import 后台的 UI 是反向依赖，
 * 而示例本来就该能整块删掉，所以这里留一份自己的（同 ./queries.ts 里的 likePattern）。
 */
function Pagination({
  query,
  page,
  totalPages,
  total,
}: {
  query: Record<string, string | undefined>;
  page: number;
  totalPages: number;
  total: number;
}) {
  const t = useTranslations("Invoices.pagination");
  const link = (target: number) => ({
    pathname: "/invoices",
    query: cleanQuery({ ...query, page: String(target) }),
  });
  const disabled = "pointer-events-none opacity-50";

  return (
    <nav
      aria-label={t("label")}
      className="text-muted-foreground flex flex-wrap items-center justify-between gap-3 text-sm"
    >
      <span>{t("summary", { page, totalPages, total })}</span>
      <div className="flex gap-2">
        <Link
          href={link(page - 1)}
          aria-disabled={page <= 1}
          tabIndex={page <= 1 ? -1 : undefined}
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            page <= 1 && disabled,
          )}
        >
          <ChevronLeft />
          {t("previous")}
        </Link>
        <Link
          href={link(page + 1)}
          aria-disabled={page >= totalPages}
          tabIndex={page >= totalPages ? -1 : undefined}
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            page >= totalPages && disabled,
          )}
        >
          {t("next")}
          <ChevronRight />
        </Link>
      </div>
    </nav>
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
      {/* GET 表单：搜索词在 URL 里，可以分享和刷新。 */}
      <form
        action={localizedPath(locale, "/invoices")}
        role="search"
        className="flex max-w-md gap-2"
      >
        <Input
          name="q"
          type="search"
          data-testid="invoice-search"
          defaultValue={query}
          aria-label={t("search")}
          placeholder={t("search")}
        />
        <Button type="submit">{t("searchButton")}</Button>
      </form>
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
            <TableRow>
              <TableCell colSpan={5}>
                {/* 标题标签由调用方指定：单元格里是一行文字，不该多出一个标题。 */}
                <EmptyState
                  size="sm"
                  icon={<ReceiptIcon />}
                  title={query ? t("noResults") : t("empty")}
                />
              </TableCell>
            </TableRow>
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
        query={{ q: query }}
        page={data.page}
        totalPages={data.totalPages}
        total={data.total}
      />
      <p className="text-muted-foreground text-sm text-pretty">{t("hint")}</p>
    </div>
  );
}
