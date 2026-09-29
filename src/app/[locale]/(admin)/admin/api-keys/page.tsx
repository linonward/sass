import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { createApiKeyService } from "@/core/api-keys/service";
import { adminMetadata } from "@/core/admin/metadata";
import { requireAdmin } from "@/core/admin/session";
import { EmptyRow } from "@/core/ui/list";
import { getDb } from "@/core/db";
import { PageHeader } from "@/core/ui/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/core/ui/table";

import siteConfig from "../../../../../../site.config";

type Props = { params: Promise<{ locale: string }> };

export function generateMetadata({ params }: Props) {
  return adminMetadata(params, "/admin/api-keys", (t) => t("apiKeys.title"));
}

/**
 * API key report: who is using the API, how many keys they hold, and when each was last used.
 *
 * Counts and timestamps only — neither plaintext nor hashes leave the admin (the plaintext is never
 * stored, and the hash means nothing to an operator).
 * With the apiKeys module off this returns 404 like every other module entry; requireAdmin turns
 * non-admins into a 404 too.
 */
export default async function AdminApiKeysPage({ params }: Props) {
  if (!siteConfig.apiKeys.enabled) notFound();
  await requireAdmin();
  const { locale } = await params;
  const [t, format, owners] = await Promise.all([
    getTranslations({ locale, namespace: "Admin.apiKeys" }),
    getFormatter({ locale }),
    createApiKeyService(getDb()).listOwners(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("description")} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("columns.user")}</TableHead>
            <TableHead className="text-right">{t("columns.keys")}</TableHead>
            <TableHead className="text-right">{t("columns.active")}</TableHead>
            <TableHead>{t("columns.lastUsed")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {owners.length === 0 && <EmptyRow colSpan={4} text={t("empty")} />}
          {owners.map((owner) => (
            <TableRow key={owner.userId} data-testid="admin-api-key-owner">
              <TableCell className="max-w-64">
                <span className="block truncate" title={owner.email}>
                  {owner.email}
                </span>
                {owner.name && (
                  <span className="text-muted-foreground block truncate text-xs">
                    {owner.name}
                  </span>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {format.number(owner.keyCount)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {format.number(owner.activeCount)}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {owner.lastUsedAt
                  ? format.dateTime(owner.lastUsedAt, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })
                  : t("never")}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-muted-foreground text-xs">{t("hint")}</p>
    </div>
  );
}
