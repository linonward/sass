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
  /** Entries sorted newest first. */
  entries: readonly ChangelogEntry[];
};

/** The changelog's RSS 2.0: each item's link is its page anchor, and the category is emitted as `<category>`. */
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
