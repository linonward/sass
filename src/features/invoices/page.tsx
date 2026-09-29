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

// List page of the example business module: pagination, search by customer name, create / edit /
// delete. The route file src/app/[locale]/(app)/invoices/page.tsx just forwards here; the
// checklist for deleting this example is at the end of ./schema.ts.

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
 * Status colors mark only what needs attention: `sent` (awaiting payment) is the only one worth a
 * glance; the rest are neutral. `paid` is the normal state with a neutral fill, draft and void use
 * the outline tier (per the rules in docs/design.md). All `flat`: the product register has no lips.
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
 * Invoice list: only the signed-in user's own invoices — queries always filter by `user_id` (see
 * ./queries.ts). Amounts are formatted with billing.currency from site.config.ts; edit and delete
 * appear only on rows.
 */
export default async function InvoicesPage({ params, searchParams }: Props) {
  // With the module off the whole page 404s: page, actions and menu item all hang off the same switch.
  if (!siteConfig.features.examples.invoices) notFound();
  const { locale } = await params;
  const search = await searchParams;
  const query = typeof search.q === "string" ? search.q : "";
  const page = parsePage(search.page);

  // Messages, formatters and the session don't depend on each other, so fire them concurrently.
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
