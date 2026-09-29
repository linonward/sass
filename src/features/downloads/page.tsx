import { DownloadIcon, PackageIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { requirePageSession } from "@/core/auth/session";
import { getDb } from "@/core/db";
import { Link } from "@/core/i18n/navigation";
import { buildMetadata } from "@/core/seo/metadata";
import { Badge } from "@/core/ui/badge";
import { buttonVariants } from "@/core/ui/button";
import { EmptyState } from "@/core/ui/empty-state";
import { PageHeader } from "@/core/ui/page-header";

import siteConfig from "../../../site.config";
import { listDownloads } from "./queries";

type Props = PageProps<"/[locale]/downloads">;

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Downloads" });
  return buildMetadata({
    locale,
    path: "/downloads",
    title: t("metaTitle"),
    noIndex: true,
  });
}

/** 文件大小：按 1024 进位，保留一位小数（12.3 MB）。 */
function fileSize(bytes: number, format: (n: number) => string) {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${format(value)} ${units[unit]}`;
}

/**
 * 下载页：当前用户的每份授权一块，列出能下的版本（新的在前）。
 * 下载按钮指向 /api/downloads/<版本 id>，那里现签一个 5 分钟的地址 —— 这一页和邮件里的
 * 链接因此永远有效，过期的只是跳转之后的那个地址。
 */
export default async function DownloadsPage({ params }: Props) {
  if (!siteConfig.downloads.enabled) notFound();
  const { locale } = await params;
  const [t, format, session] = await Promise.all([
    getTranslations({ locale, namespace: "Downloads" }),
    getFormatter({ locale }),
    requirePageSession(locale),
  ]);
  const entries = await listDownloads(getDb(), session.user.id);
  const date = (d: Date) => format.dateTime(d, { dateStyle: "medium" });
  const size = (bytes: number) =>
    fileSize(bytes, (n) => format.number(n, { maximumFractionDigits: 1 }));
  const productName = (id: string) =>
    t.has(`products.${id}.name` as "products.template.name")
      ? t(`products.${id}.name` as "products.template.name")
      : id;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("description")} />
      {entries.length === 0 && (
        <EmptyState
          icon={<PackageIcon />}
          title={t("empty")}
          description={t("emptyDescription")}
        >
          <Link href="/#delivery" className={buttonVariants()}>
            {t("emptyCta")}
          </Link>
        </EmptyState>
      )}
      {entries.map((entry) => (
        // 不套面板：表格 / 列表直接躺在画布上（docs/design.md「表格不套面板」）。
        // 用列表不用表格：375px 下下载按钮始终在视野里，不出现横向滚动。
        <section
          key={entry.id}
          className="flex flex-col gap-3"
          data-testid="download-entitlement"
        >
          <div>
            <h2 className="heading-display text-lg">
              {productName(entry.productId)}
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {t("purchased", { date: date(entry.purchasedAt) })}
              {" · "}
              {entry.revokedAt
                ? t("revoked")
                : t("updatesUntil", { date: date(entry.updatesUntil) })}
            </p>
          </div>
          {entry.revokedAt ? null : entry.releases.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("noReleases")}</p>
          ) : (
            <ul className="divide-border border-border divide-y border-y">
              {entry.releases.map((release, index) => (
                <li
                  key={release.id}
                  className="flex items-center gap-4 py-3"
                  data-testid="download-release"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {release.version}
                      {index === 0 && (
                        <Badge variant="secondary" flat>
                          {t("latest")}
                        </Badge>
                      )}
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-sm">
                      {date(release.publishedAt)}
                      {" · "}
                      <span data-numeric>{size(release.size)}</span>
                    </p>
                  </div>
                  {/* API 路由返回跳转，不走客户端路由，所以用 <a> 而不是 Link。 */}
                  <a
                    href={`/api/downloads/${release.id}`}
                    className={buttonVariants({
                      variant: index === 0 ? "default" : "outline",
                      size: "sm",
                    })}
                    aria-label={t("downloadVersion", {
                      version: release.version,
                    })}
                  >
                    <DownloadIcon />
                    {t("download")}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
      <p className="text-muted-foreground text-sm text-pretty">
        {t.rich("help", {
          email: siteConfig.legal.contactEmail,
          link: (chunks) => (
            <a
              href={`mailto:${siteConfig.legal.contactEmail}`}
              className="text-primary-text underline underline-offset-4"
            >
              {chunks}
            </a>
          ),
        })}
      </p>
    </div>
  );
}
