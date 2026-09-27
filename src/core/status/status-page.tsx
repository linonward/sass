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

/** 确认 / 退订跳回来时的一次性提示的配色。 */
const noticeTone: Record<string, string> = {
  subscribed: "bg-primary-band text-primary-text [--edge:var(--primary-edge)]",
  unsubscribed: "bg-muted text-muted-foreground [--edge:var(--border)]",
  expired: "bg-warning-band text-warning [--edge:var(--warning-edge)]",
};

export type StatusNotice = "subscribed" | "unsubscribed" | "expired";

/** 整体横幅和每行的颜色：operational 用品牌色，异常才上语义色（见 docs/design.md）。 */
const bannerTone: Record<string, string> = {
  operational: "bg-primary-band text-primary-text [--edge:var(--primary-edge)]",
  degraded: "bg-warning-band text-warning [--edge:var(--warning-edge)]",
  outage:
    "bg-destructive-band text-destructive [--edge:var(--destructive-edge)]",
};

/** 徽章的语义档。营销面所以是贴纸（不传 flat），和博客卡片上的标签同一套语言。 */
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
 * `/status` 的页面主体。走营销面语域（`docs/design.md` §4.5）：浅色带的页头、波浪过渡到
 * 画布、内容是贴纸；但比营销页安静 —— 这一页是给人「一眼看完」的，不是说服人的。
 *
 * 它自己也负责触发 auto 模式的探测：v1 不引入 cron，页面渲染时同步跑一遍。
 * 探测失败不能让整页 500 —— 状态页在故障期间正好是最该打开的那个页面。
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
      // 库里存的是 UTC 墙钟，按 UTC 显示：访客的本地时区由浏览器决定，
      // 服务端不能拿自己的时区当默认值（否则本地和 CI 渲染出的时间不一样）。
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
            {/* 整页每次渲染都会重新读库（auto 模式下还会重跑探测），刷新就是重新请求。
                用普通链接而不是客户端路由，确保拿到的是服务端重新渲染的结果。 */}
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

          {/* 订阅是可选功能：v1 只在 incident 变更时发通知，不发日报，也不引入 cron。 */}
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
