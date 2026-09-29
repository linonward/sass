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

/** File size: base 1024, one decimal place (12.3 MB). */
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
 * Downloads page: one block per grant the current user holds, listing the downloadable versions
 * (newest first). Download buttons point to /api/downloads/<version id>, which signs a fresh
 * 5-minute URL — so links on this page and in emails never expire; only the URL behind the
 * redirect does.
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
        // No panel: tables / lists sit directly on the canvas (docs/design.md: tables don't get a
        // panel). A list rather than a table: at 375px the download button stays in view with no
        // horizontal scrolling.
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
                  {/* The API route returns a redirect and bypasses client routing, so use <a> rather than Link. */}
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
