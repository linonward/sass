import { getFormatter, getTranslations } from "next-intl/server";

import { adminMetadata } from "@/core/admin/metadata";
import { listUsers } from "@/core/admin/queries";
import { requireAdmin } from "@/core/admin/session";
import { RoleBadge, UserStatusBadge } from "@/core/admin/ui/badges";
import { creditsEnabled } from "@/core/credits";
import { getDb } from "@/core/db";
import { Link } from "@/core/i18n/navigation";
import { parsePage } from "@/core/lib/pagination";
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

type Props = PageProps<"/[locale]/admin/users">;

export function generateMetadata({ params }: Props) {
  return adminMetadata(params, "/admin/users", (t) => t("users.title"));
}

export default async function AdminUsersPage({ params, searchParams }: Props) {
  await requireAdmin();
  const { locale } = await params;
  const search = await searchParams;
  const query = typeof search.q === "string" ? search.q : "";
  const page = parsePage(search.page);

  // Messages, formatters and the list query don't depend on each other, so fire them concurrently.
  const [t, format, data] = await Promise.all([
    getTranslations({ locale, namespace: "Admin.users" }),
    getFormatter({ locale }),
    listUsers(getDb(), { query, page }),
  ]);
  const columns = creditsEnabled ? 5 : 4;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("description")} />
      <ListToolbar
        pathname="/admin/users"
        value={query}
        label={t("search")}
        submitLabel={t("searchButton")}
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("columns.user")}</TableHead>
            <TableHead>{t("columns.role")}</TableHead>
            <TableHead>{t("columns.status")}</TableHead>
            {creditsEnabled && (
              <TableHead className="text-right">
                {t("columns.credits")}
              </TableHead>
            )}
            <TableHead>{t("columns.joined")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.rows.length === 0 && (
            <EmptyRow
              colSpan={columns}
              text={t("empty")}
              filtered={query ? { pathname: "/admin/users" } : undefined}
            />
          )}
          {data.rows.map((user) => (
            <TableRow key={user.id}>
              <TableCell className="max-w-72">
                <Link
                  href={`/admin/users/${user.id}`}
                  className="hover:text-primary-text block truncate font-medium"
                >
                  {user.email}
                </Link>
                {user.name && (
                  <span className="text-muted-foreground block truncate text-xs">
                    {user.name}
                  </span>
                )}
              </TableCell>
              <TableCell>
                <RoleBadge role={user.role} />
              </TableCell>
              <TableCell>
                <UserStatusBadge banned={user.banned} />
              </TableCell>
              {creditsEnabled && (
                <TableCell className="text-right tabular-nums">
                  {format.number(user.balance ?? 0)}
                </TableCell>
              )}
              <TableCell className="text-muted-foreground">
                {format.dateTime(user.createdAt, { dateStyle: "medium" })}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Pagination
        pathname="/admin/users"
        query={{ q: query }}
        page={data.page}
        totalPages={data.totalPages}
        total={data.total}
      />
    </div>
  );
}
