import { RefreshCw } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { getDb } from "@/core/db";
import { bandBg } from "@/core/marketing/sections/band";
import { Wave } from "@/core/marketing/sections/wave";
import { logger } from "@/core/observability/logger";
import { buildMetadata } from "@/core/seo/metadata";
import { localizedPath } from "@/core/seo/urls";
import { Badge } from "@/core/ui/badge";
import { buttonVariants } from "@/core/ui/button";
import type { StatusEventStatus } from "@/core/db/schema/status";

import siteConfig from "../../../site.config";
import { runAutoChecks } from "./health";
import { statusPageEnabled } from "./index";
import { componentLabel } from "./status";
import { SubscribeForm } from "./subscribe-form";
import { getStatusBoard } from "./store";

const namespace = "Status";

/** Colors for the one-off notice shown after returning from confirm / unsubscribe. */
const noticeTone: Record<string, string> = {
  subscribed: "bg-primary-band text-primary-text [--edge:var(--primary-edge)]",
  unsubscribed: "bg-muted text-muted-foreground [--edge:var(--border)]",
  expired: "bg-warning-band text-warning [--edge:var(--warning-edge)]",
};

export type StatusNotice = "subscribed" | "unsubscribed" | "expired";

/**
 * Colors for the overall banner and each row: operational uses the brand color; only problems get
 * semantic colors (see docs/design.md).
 */
const bannerTone: Record<string, string> = {
  operational: "bg-primary-band text-primary-text [--edge:var(--primary-edge)]",
  degraded: "bg-warning-band text-warning [--edge:var(--warning-edge)]",
  outage:
    "bg-destructive-band text-destructive [--edge:var(--destructive-edge)]",
};

/**
 * Badge semantic variants. This is a marketing surface, so badges are stickers (no `flat`) — the
 * same visual language as the tags on blog cards.
 */
const badgeVariant: Record<
  StatusEventStatus,
  "band" | "warning" | "destructive-band"
> = {
  operational: "band",
  degraded: "warning",
  outage: "destructive-band",
};

const barTone: Record<StatusEventStatus, string> = {
  operational: "bg-primary",
  degraded: "bg-warning",
  outage: "bg-destructive",
};

export async function statusPageMetadata(locale: string) {
  const t = await getTranslations({ locale, namespace });
  return buildMetadata({
    locale,
    path: "/status",
    title: t("metaTitle"),
    description: t("metaDescription", {
      name: siteConfig.name,
      days: siteConfig.statusPage.historyDays,
    }),
  });
}

/**
 * Body of the `/status` page. Uses the marketing-surface register (`docs/design.md` §4.5): a
 * light-band header with a wave transition into the canvas, and stickers for content — but quieter
 * than the marketing pages: this page is meant to be taken in at a glance, not to persuade.
 *
 * It also triggers the auto-mode probes itself: v1 has no cron, so they run synchronously during
 * render. A failed probe must not 500 the whole page — during an outage, the status page is
 * exactly the page people most need to open.
 */
export async function StatusPage({
  locale,
  notice,
}: {
  locale: string;
  notice?: StatusNotice;
}) {
  if (!statusPageEnabled) notFound();
  const config = siteConfig.statusPage;
  const db = getDb();

  if (config.mode === "auto") {
    try {
      await runAutoChecks(db, config);
    } catch (error) {
      logger.error("status.auto_check_failed", { error });
    }
  }

  const [t, format, board] = await Promise.all([
    getTranslations({ locale, namespace }),
    getFormatter({ locale }),
    getStatusBoard(db, config),
  ]);

  const date = (value: Date) =>
    format.dateTime(value, {
      dateStyle: "medium",
      timeStyle: "short",
      // The database stores UTC wall-clock time, so display it in UTC: the visitor's local time
      // zone is up to the browser, and the server must not default to its own time zone
      // (otherwise local and CI renders would show different times).
      timeZone: "UTC",
    });

  return (
    <>
      <section className={bandBg.tint}>
        <div className="container-marketing py-14 sm:py-20">
          <header className="flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-2xl">
              <h1 className="heading-display text-4xl sm:text-5xl">
                {t("title")}
              </h1>
              <p className="text-muted-foreground mt-4 text-lg text-pretty">
                {t("description")}
              </p>
            </div>
            {/* The whole page re-reads the database on every render (and re-runs the probes in auto
                mode), so refreshing is just a new request. Use a plain link rather than client-side
                routing to make sure the result is a fresh server render. */}
            <a
              href={localizedPath(locale, "/status")}
              className={buttonVariants({
                variant: "outline",
                size: "marketing",
              })}
            >
              <RefreshCw />
              {t("refresh")}
            </a>
          </header>
        </div>
      </section>

      <section className={bandBg.canvas}>
        <Wave from="tint" />
        <div className="container-marketing space-y-10 pt-8 pb-14 sm:pt-10 sm:pb-20">
          {notice && (
            <p
              role="status"
              className={`sticker rounded-xl border-[var(--edge)] px-5 py-3 text-sm ${noticeTone[notice]}`}
            >
              {t(`notice.${notice}`)}
            </p>
          )}

          <div
            className={`sticker-lg rounded-2xl border-[var(--edge)] p-6 sm:p-8 ${bannerTone[board.overall]}`}
          >
            <p
              className="heading-display text-2xl sm:text-3xl"
              data-testid="status-overall"
            >
              {t(`overall.${board.overall}`)}
            </p>
            <p className="mt-2 text-sm text-pretty opacity-80">
              {t(`overallHint.${board.overall}`)}
            </p>
          </div>

          {board.components.length > 0 && (
            <section aria-labelledby="status-components">
              <h2
                id="status-components"
                className="heading-display text-xl sm:text-2xl"
              >
                {t("componentsTitle")}
              </h2>
              <ul className="bg-card sticker divide-border mt-5 divide-y rounded-xl">
                {board.components.map((component) => (
                  <li
                    key={component.key}
                    className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:gap-8"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <h3 className="heading-display text-base">
                          {component.label}
                        </h3>
                        <Badge variant={badgeVariant[component.status.status]}>
                          {t(`statusLabel.${component.status.status}`)}
                        </Badge>
                      </div>
                      {component.description && (
                        <p className="text-muted-foreground mt-1 text-sm text-pretty">
                          {component.description}
                        </p>
                      )}
                      {component.status.message && (
                        <p className="mt-1 text-sm text-pretty">
                          {component.status.message}
                        </p>
                      )}
                      {component.status.since && (
                        <p className="text-muted-foreground mt-1 text-xs">
                          {t("since", { date: date(component.status.since) })}
                        </p>
                      )}
                    </div>
                    <div className="w-full shrink-0 sm:w-40">
                      <div
                        aria-hidden
                        className="bg-muted h-1.5 w-full overflow-hidden rounded-full"
                      >
                        <div
                          className={`h-full rounded-full ${barTone[component.status.status]}`}
                          style={{ width: `${component.uptime}%` }}
                        />
                      </div>
                      <p className="text-muted-foreground mt-1.5 text-xs">
                        {t("uptime", {
                          days: config.historyDays,
                          value: format.number(component.uptime, {
                            maximumFractionDigits: 2,
                          }),
                        })}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="status-incidents">
            <h2
              id="status-incidents"
              className="heading-display text-xl sm:text-2xl"
            >
              {t("incidentsTitle")}
            </h2>
            {board.incidents.length === 0 ? (
              <p className="bg-card sticker text-muted-foreground mt-5 rounded-xl p-8 text-center">
                {t("noIncidents", { days: config.historyDays })}
              </p>
            ) : (
              <ol className="mt-5 space-y-4">
                {board.incidents.map((incident) => (
                  <li
                    key={incident.id}
                    className="bg-card sticker rounded-xl p-5"
                  >
                    <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                      <Badge variant={badgeVariant[incident.status]}>
                        {t(`statusLabel.${incident.status}`)}
                      </Badge>
                      <span className="font-medium">
                        {componentLabel(config.components, incident.component)}
                      </span>
                      <time dateTime={incident.createdAt.toISOString()}>
                        {date(incident.createdAt)}
                      </time>
                      {incident.source === "auto" && (
                        <span className="text-xs">{t("source.auto")}</span>
                      )}
                    </div>
                    <p className="mt-2 text-pretty">{incident.message}</p>
                    <p className="text-muted-foreground mt-2 text-sm">
                      {incident.resolvedAt
                        ? t("resolvedAt", { date: date(incident.resolvedAt) })
                        : t("ongoing")}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {/* Subscriptions are optional: v1 notifies only on incident changes — no daily digest,
              no cron. */}
          <section
            aria-labelledby="status-subscribe"
            className="bg-card sticker rounded-xl p-6 sm:p-8"
          >
            <h2
              id="status-subscribe"
              className="heading-display text-xl sm:text-2xl"
            >
              {t("subscribe.title")}
            </h2>
            <p className="text-muted-foreground mt-2 text-sm text-pretty">
              {t("subscribe.description")}
            </p>
            <div className="mt-5">
              <SubscribeForm locale={locale} />
            </div>
          </section>
        </div>
      </section>
    </>
  );
}
