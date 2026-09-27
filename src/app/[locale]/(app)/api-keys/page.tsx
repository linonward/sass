import { KeyRoundIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { CreateKeyDialog, RevokeKeyDialog } from "@/core/api-keys/dialogs";
import { createApiKeyService } from "@/core/api-keys/service";
import { apiKeyStatus, type ApiKeyStatus } from "@/core/api-keys/status";
import { requirePageSession } from "@/core/auth/session";
import { getDb } from "@/core/db";
import { buildMetadata } from "@/core/seo/metadata";
import { Badge } from "@/core/ui/badge";
import { EmptyState } from "@/core/ui/empty-state";
import { PageHeader } from "@/core/ui/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/core/ui/table";

import siteConfig from "../../../../../site.config";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/api-keys">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "ApiKeys" });
  return buildMetadata({
    locale,
    path: "/api-keys",
    title: t("metaTitle"),
    noIndex: true,
  });
}

/** 状态徽章：只有需要看一眼的状态上语义色，有效态是中性填充。 */
function StatusBadge({
  status,
  label,
}: {
  status: ApiKeyStatus;
  label: string;
}) {
  if (status === "revoked") {
    return (
      <Badge variant="destructive-band" flat>
        {label}
      </Badge>
    );
  }
  if (status === "expired") return <Badge variant="outline">{label}</Badge>;
  return <Badge variant="secondary">{label}</Badge>;
}

/**
 * API Key 管理页：列出自己的 key（明文和哈希都不经过这里）、新建、撤销。
 * 明文只在新建的那个弹层里出现一次，之后连本人都看不到。
 */
export default async function ApiKeysPage({
  params,
}: PageProps<"/[locale]/api-keys">) {
  if (!siteConfig.apiKeys.enabled) notFound();
  const { locale } = await params;
  const [t, format, session] = await Promise.all([
    getTranslations({ locale, namespace: "ApiKeys" }),
    getFormatter({ locale }),
    requirePageSession(locale),
  ]);
  const keys = await createApiKeyService(getDb()).listForUser(session.user.id);
  const date = (value: Date) => format.dateTime(value, { dateStyle: "medium" });
  const dateTime = (value: Date) =>
    format.dateTime(value, { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("description")}>
        <CreateKeyDialog locale={locale} />
      </PageHeader>

      {keys.length === 0 ? (
        <div className="panel p-6">
          <EmptyState
            icon={<KeyRoundIcon />}
            titleAs="h2"
            title={t("empty")}
            description={t("emptyHint")}
          />
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.name")}</TableHead>
              <TableHead>{t("columns.key")}</TableHead>
              <TableHead>{t("columns.created")}</TableHead>
              <TableHead>{t("columns.lastUsed")}</TableHead>
              <TableHead>{t("columns.status")}</TableHead>
              <TableHead className="text-right">
                {t("columns.actions")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys.map((key) => {
              const status = apiKeyStatus(key);
              return (
                <TableRow key={key.id} data-testid="api-key-row">
                  <TableCell
                    className="font-medium"
                    data-testid="api-key-row-name"
                  >
                    {key.name}
                  </TableCell>
                  {/* 只显示前缀：它够认出是哪把，不足以反推明文。 */}
                  <TableCell className="text-muted-foreground font-mono text-xs">
                    {key.prefix}…
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {date(key.createdAt)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {key.lastUsedAt ? dateTime(key.lastUsedAt) : t("never")}
                  </TableCell>
                  <TableCell data-testid="api-key-row-status">
                    <StatusBadge
                      status={status}
                      label={t(`status.${status}`)}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    {/* 只有还能用的 key 才给撤销按钮：已撤销、已过期的撤销没有意义。 */}
                    {status === "active" && (
                      <RevokeKeyDialog
                        locale={locale}
                        keyId={key.id}
                        name={key.name}
                      />
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <p className="text-muted-foreground text-sm text-pretty">
        {t("usageHint")}
      </p>
    </div>
  );
}
