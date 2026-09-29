import { getFormatter, getTranslations } from "next-intl/server";

import { adminMetadata } from "@/core/admin/metadata";
import { parsePage } from "@/core/lib/pagination";
import { requireAdmin } from "@/core/admin/session";
import { EmptyRow, Pagination, StatusFilter } from "@/core/ui/list";
import {
  billingExceptionKinds,
  billingExceptionStatuses,
  type BillingExceptionStatus,
} from "@/core/db/schema";
import { getDb } from "@/core/db";
import {
  listExceptions,
  parseExceptionKind,
  parseExceptionStatus,
  type ExceptionRow,
} from "@/core/exceptions/queries";
import { HandleExceptionDialog } from "@/core/exceptions/ui/handle-dialog";
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

type Props = PageProps<"/[locale]/admin/exceptions">;

/**
 * Status colors mark only what needs attention: open is the reason this page exists, so it gets
 * warning; resolved is neutral, ignored gets the outline tier. All `flat`: the product register has
 * no lips.
 */
const statusVariant = {
  open: "warning",
  resolved: "secondary",
  ignored: "outline",
} as const satisfies Record<BillingExceptionStatus, string>;

const linkClass = "hover:text-primary-text underline-offset-4 hover:underline";

export function generateMetadata({ params }: Props) {
  return adminMetadata(params, "/admin/exceptions", (t) =>
    t("exceptions.title"),
  );
}

export default async function AdminExceptionsPage({
  params,
  searchParams,
}: Props) {
  await requireAdmin();
  const { locale } = await params;
  const search = await searchParams;
  const status = parseExceptionStatus(search.status);
  const kind = parseExceptionKind(search.kind);
  const page = parsePage(search.page);

  const [t, format, data] = await Promise.all([
    getTranslations({ locale, namespace: "Admin.exceptions" }),
    getFormatter({ locale }),
    listExceptions(getDb(), { status, kind, page }),
  ]);
  const when = (date: Date) =>
    format.dateTime(date, { dateStyle: "medium", timeStyle: "short" });

  /**
   * Summary: a shortfall exception shows the order and how much is owed, an AI exception shows the job
   * and the credits; context and handling history follow below.
   */
  function Summary({ row }: { row: ExceptionRow }) {
    const d = row.detail as Record<string, string | number | boolean | null>;
    return (
      <div className="flex max-w-md min-w-60 flex-col gap-1.5 whitespace-normal">
        <span>
          <Badge variant="outline">{t(`kinds.${row.kind}`)}</Badge>
        </span>
        {row.kind === "refund_reclaim_shortfall" ? (
          <span>
            {t("shortfall", {
              orderId: String(d.orderId ?? "—"),
              shortfall: Number(d.shortfall ?? 0),
              owed: Number(d.owed ?? 0),
              reclaimed: Number(d.reclaimed ?? 0),
            })}
          </span>
        ) : row.kind === "notification_failed" ? (
          <span>
            {t("notification", {
              template: String(d.template ?? "—"),
              to: String(d.to ?? "—"),
            })}
          </span>
        ) : (
          <>
            <span>
              {t("aiJob", {
                usageId: String(d.usageId ?? row.sourceId).slice(0, 8),
                modelId: String(d.modelId ?? "—"),
                credits: Number(d.credits ?? 0),
              })}
              {d.refunded ? ` · ${t("refunded")}` : null}
            </span>
            {d.reason && (
              <span className="text-muted-foreground text-xs">
                {t("reason", { reason: String(d.reason) })}
              </span>
            )}
            {d.providerStatus && (
              <span className="text-muted-foreground text-xs">
                {t("providerStatus", { status: String(d.providerStatus) })}
              </span>
            )}
          </>
        )}
        {/* Lookups: user, order, credit transactions. */}
        <span className="text-muted-foreground flex flex-wrap gap-x-3 text-xs">
          <Link href={`/admin/users/${row.userId}`} className={linkClass}>
            {t("links.user")}
          </Link>
          {row.kind === "refund_reclaim_shortfall" && (
            <Link href="/admin/orders" className={linkClass}>
              {t("links.orders")}
            </Link>
          )}
          <Link
            href={`/admin/users/${row.userId}#credits`}
            className={linkClass}
          >
            {t("links.credits")}
          </Link>
        </span>
        {row.resolution && (
          <span className="text-muted-foreground text-xs">
            {t("resolution", { resolution: row.resolution })}
          </span>
        )}
        {row.history.length > 0 && (
          <details className="text-xs" data-testid="exception-history">
            <summary className="text-muted-foreground cursor-pointer">
              {t("history.summary", { count: row.history.length })}
            </summary>
            <ol className="mt-1.5 flex flex-col gap-1.5">
              {row.history.map((entry) => (
                <li key={entry.id} className="border-border border-l pl-2">
                  <span className="block">
                    {t("history.entry", {
                      date: when(entry.createdAt),
                      actor: entry.actorEmail ?? t("history.unknownActor"),
                      action: t(
                        `actions.${entry.action as "resolve" | "ignore" | "retry_reclaim" | "recheck" | "resend"}`,
                      ),
                      result: entry.result,
                    })}
                  </span>
                  <span className="text-muted-foreground block">
                    {t("history.reason", { reason: entry.reason })}
                  </span>
                </li>
              ))}
            </ol>
          </details>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("description")} />
      <div className="flex flex-col gap-2">
        <StatusFilter
          pathname="/admin/exceptions"
          statuses={billingExceptionStatuses}
          current={status}
          label={(value) => t(`statuses.${value}`)}
          query={{ kind }}
        />
        <StatusFilter
          pathname="/admin/exceptions"
          statuses={billingExceptionKinds}
          current={kind}
          label={(value) => t(`kinds.${value}`)}
          param="kind"
          query={{ status }}
          ariaLabel={t("kindFilter")}
        />
      </div>
      <Table>
        <TableHeader>
          {/* Summary and status (including "handle") come first: on narrow screens the table scrolls
              horizontally, so what needs handling is what you see first. */}
          <TableRow>
            <TableHead>{t("columns.summary")}</TableHead>
            <TableHead>{t("columns.status")}</TableHead>
            <TableHead>{t("columns.user")}</TableHead>
            <TableHead className="text-right">
              {t("columns.attempts")}
            </TableHead>
            <TableHead>{t("columns.lastError")}</TableHead>
            <TableHead>{t("columns.opened")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.rows.length === 0 && (
            <EmptyRow
              colSpan={6}
              text={t("empty")}
              filtered={
                status || kind ? { pathname: "/admin/exceptions" } : undefined
              }
            />
          )}
          {data.rows.map((row) => (
            <TableRow
              key={row.id}
              className="align-top"
              data-testid="exception-row"
              data-exception-id={row.id}
            >
              <TableCell>
                <Summary row={row} />
              </TableCell>
              <TableCell>
                <div className="flex flex-col items-start gap-2">
                  <Badge variant={statusVariant[row.status]} flat>
                    {t(`statuses.${row.status}`)}
                  </Badge>
                  {row.status === "open" && (
                    <HandleExceptionDialog
                      exceptionId={row.id}
                      kind={row.kind}
                    />
                  )}
                </div>
              </TableCell>
              <TableCell className="max-w-48">
                <Link
                  href={`/admin/users/${row.userId}`}
                  className="hover:text-primary-text block truncate"
                >
                  {row.email}
                </Link>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.attempts}
              </TableCell>
              <TableCell className="text-muted-foreground max-w-48 min-w-32 text-xs whitespace-normal">
                {row.lastError ?? "—"}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {when(row.createdAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Pagination
        pathname="/admin/exceptions"
        query={{ status, kind }}
        page={data.page}
        totalPages={data.totalPages}
        total={data.total}
      />
    </div>
  );
}
