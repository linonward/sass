import { MDXContent } from "@content-collections/mdx/react";
import { Rss } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";

import { bandBg } from "@/core/marketing/sections/band";
import { Wave } from "@/core/marketing/sections/wave";
import { localizedPath } from "@/core/seo/urls";
import { Badge } from "@/core/ui/badge";
import { buttonVariants } from "@/core/ui/button";

import {
  feedPath,
  groupByMonth,
  type ChangelogCategory,
  type ChangelogEntry,
} from "./entries";

/** 类别 → 徽章变体：feature 绿、improvement 蓝、fix 中性（`docs/design.md` §4.5 的语义档）。 */
const categoryBadge: Record<ChangelogCategory, "success" | "info" | "outline"> =
  {
    feature: "success",
    improvement: "info",
    fix: "outline",
  };

function EntryCard({ entry }: { entry: ChangelogEntry }) {
  const t = useTranslations("Changelog");
  const format = useFormatter();

  return (
    // 锚点给 RSS 用：更新日志是单页，每条靠 id 才有自己的地址（见 entries.ts 的 entryAnchor）。
    <article
      id={entry.slug}
      className="bg-card sticker scroll-mt-24 rounded-xl p-6 sm:p-8"
    >
      <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-sm">
        {/* 只有日期，按 UTC 零点渲染：时区不同不该显示成前一天。 */}
        <time dateTime={entry.date}>
          {format.dateTime(new Date(`${entry.date}T00:00:00Z`), {
            dateStyle: "long",
            timeZone: "UTC",
          })}
        </time>
        <Badge variant={categoryBadge[entry.category]}>
          {t(`categories.${entry.category}`)}
        </Badge>
      </div>
      <h3 className="heading-display mt-3 text-xl">{entry.title}</h3>
      {/* 正文用 typography 排版，去掉行内代码的反引号和引用的斜体 —— 和文章页同一套。 */}
      <div className="prose prose-sm prose-neutral dark:prose-invert prose-a:text-primary-text prose-a:underline-offset-4 prose-headings:font-display prose-headings:font-semibold prose-headings:tracking-tight prose-code:before:content-none prose-code:after:content-none prose-blockquote:font-normal prose-blockquote:not-italic [&_:not(pre)>code]:bg-muted mt-4 max-w-none [&_:not(pre)>code]:rounded [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:font-medium [&_blockquote_p]:before:content-none [&_blockquote_p]:after:content-none">
        <MDXContent code={entry.mdx} />
      </div>
    </article>
  );
}

/**
 * 更新日志页：页头色带、波浪过渡到画布，条目按月份分组，每组是一列贴纸卡片。
 *
 * 走营销面的语域（`docs/design.md` §4.5）：它自带色带，不套 `(marketing)/layout.tsx`
 * 里的任何容器。
 */
export function ChangelogList({ entries }: { entries: ChangelogEntry[] }) {
  const t = useTranslations("Changelog");
  const locale = useLocale();
  const format = useFormatter();

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
            {/* RSS 是 route handler，用普通链接，不走客户端路由。 */}
            <a
              href={localizedPath(locale, feedPath)}
              className={buttonVariants({
                variant: "outline",
                size: "marketing",
              })}
            >
              <Rss />
              {t("rss")}
            </a>
          </header>
        </div>
      </section>
      <section className={bandBg.canvas}>
        <Wave from="tint" />
        <div className="container-marketing pt-8 pb-14 sm:pt-10 sm:pb-20">
          {entries.length === 0 ? (
            <p className="bg-card sticker text-muted-foreground rounded-xl p-12 text-center">
              {t("empty")}
            </p>
          ) : (
            groupByMonth(entries).map(({ month, entries }) => (
              <section key={month} className="mt-10 first:mt-0">
                {/* 月份按当前语言渲染（「September 2026」），不在 messages 里写死。 */}
                <h2 className="heading-display text-2xl">
                  {format.dateTime(new Date(`${month}-01T00:00:00Z`), {
                    month: "long",
                    year: "numeric",
                    timeZone: "UTC",
                  })}
                </h2>
                <ul className="mt-6 space-y-6">
                  {entries.map((entry) => (
                    <li key={entry.slug}>
                      <EntryCard entry={entry} />
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </section>
    </>
  );
}
