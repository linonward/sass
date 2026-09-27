import { buildRssFeed } from "@/core/seo/rss";

import {
  changelogPath,
  entryAnchor,
  feedPath,
  type ChangelogEntry,
} from "./entries";

export type ChangelogFeedOptions = {
  locale: string;
  title: string;
  description: string;
  /** 已按日期倒序的条目。 */
  entries: readonly ChangelogEntry[];
};

/** 更新日志的 RSS 2.0：条目的 link 是页面上的锚点，类别输出成 `<category>`。 */
export function buildChangelogFeed({
  locale,
  title,
  description,
  entries,
}: ChangelogFeedOptions): string {
  return buildRssFeed({
    locale,
    title,
    description,
    pagePath: changelogPath,
    feedPath,
    items: entries.map((entry) => ({
      title: entry.title,
      path: entryAnchor(entry.slug),
      date: entry.date,
      description: entry.description,
      categories: [entry.category],
    })),
  });
}
