import { getFormatter, getTranslations } from "next-intl/server";

import { adminMetadata } from "@/core/admin/metadata";
import { listUsers, parsePage } from "@/core/admin/queries";
import { requireAdmin } from "@/core/admin/session";
import {
  EmptyRow,
  Pagination,
  RoleBadge,
  UserStatusBadge,
} from "@/core/admin/ui/list";
import { creditsEnabled } from "@/core/credits";
import { getDb } from "@/core/db";
import { Link } from "@/core/i18n/navigation";
import { localizedPath } from "@/core/seo/urls";
import { Button } from "@/core/ui/button";
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

  const t = await getTranslations({ locale, namespace: "Admin.users" });
  const format = await getFormatter({ locale });
  const data = await listUsers(getDb(), { query, page });
  const columns = creditsEnabled ? 5 : 4;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("description")} />
      {/* GET 表单：搜索词在 URL 里，可以分享和刷新。 */}
      <form
        action={localizedPath(locale, "/admin/users")}
        role="search"
        className="flex max-w-md gap-2"
      >
        <Input
          name="q"
          type="search"
          defaultValue={query}
          aria-label={t("search")}
          placeholder={t("search")}
        />
        {/* 这一屏唯一的实心主操作。 */}
        <Button type="submit">{t("searchButton")}</Button>
      </form>
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
            <EmptyRow colSpan={columns} text={t("empty")} />
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
