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

/** Category → badge variant: feature green, improvement blue, fix neutral (semantic tones from `docs/design.md` §4.5). */
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
    // The anchor is for RSS: the changelog is a single page, so each entry only has its own address
    // via its id (see entryAnchor in entries.ts).
    <article
      id={entry.slug}
      className="bg-card sticker scroll-mt-24 rounded-xl p-6 sm:p-8"
    >
      <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-sm">
        {/* Date only, rendered at UTC midnight: a different time zone shouldn't show the previous day. */}
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
      {/* Body is typeset with typography, minus the backticks on inline code and italics on blockquotes — same as the post page. */}
      <div className="prose prose-sm prose-neutral dark:prose-invert prose-a:text-primary-text prose-a:underline-offset-4 prose-headings:font-display prose-headings:font-semibold prose-headings:tracking-tight prose-code:before:content-none prose-code:after:content-none prose-blockquote:font-normal prose-blockquote:not-italic [&_:not(pre)>code]:bg-muted mt-4 max-w-none [&_:not(pre)>code]:rounded [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:font-medium [&_blockquote_p]:before:content-none [&_blockquote_p]:after:content-none">
        <MDXContent code={entry.mdx} />
      </div>
    </article>
  );
}

/**
 * Changelog page: header band with a wave transition to the canvas; entries grouped by month, each
 * group a column of sticker cards.
 *
 * Uses the marketing-surface register (`docs/design.md` §4.5): it brings its own band and doesn't
 * use any container from `(marketing)/layout.tsx`.
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
            {/* RSS is a route handler, so use a plain link rather than client-side routing. */}
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
                {/* The month is rendered in the current locale ("September 2026"), not hard-coded in messages. */}
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
