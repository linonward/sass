import { absoluteUrl } from "@/core/seo/urls";

export function escapeXml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[char]!,
  );
}

/** RSS requires RFC 822 dates; entries only have a date, so it's taken as UTC midnight. */
function rfc822(date: string) {
  return new Date(`${date}T00:00:00Z`).toUTCString();
}

export type RssItem = {
  title: string;
  /** The item's site-relative path (without the locale prefix), e.g. `/blog/hello-world`. Used as both link and guid. */
  path: string;
  /** Publish date, e.g. `2026-01-31`. */
  date: string;
  description: string;
  /** Optional categories, emitted as multiple `<category>` elements (blog tags, changelog categories). */
  categories?: readonly string[];
};

export type RssFeedOptions = {
  locale: string;
  title: string;
  description: string;
  /** Site-relative path of the list page (without the locale prefix), used as the channel link. */
  pagePath: string;
  /** The feed's own site-relative path (without the locale prefix), for `atom:link rel="self"`. */
  feedPath: string;
  /** Items sorted newest first. */
  items: readonly RssItem[];
};

/** Generates RSS 2.0. lastBuildDate is the newest item's date, so unchanged content produces unchanged output. */
export function buildRssFeed({
  locale,
  title,
  description,
  pagePath,
  feedPath,
  items,
}: RssFeedOptions): string {
  const itemsXml = items.map((item) => {
    const url = absoluteUrl(locale, item.path);
    return [
      "    <item>",
      `      <title>${escapeXml(item.title)}</title>`,
      `      <link>${url}</link>`,
      `      <guid isPermaLink="true">${url}</guid>`,
      `      <pubDate>${rfc822(item.date)}</pubDate>`,
      `      <description>${escapeXml(item.description)}</description>`,
      ...(item.categories ?? []).map(
        (category) => `      <category>${escapeXml(category)}</category>`,
      ),
      "    </item>",
    ].join("\n");
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${escapeXml(title)}</title>`,
    `    <link>${absoluteUrl(locale, pagePath)}</link>`,
    `    <description>${escapeXml(description)}</description>`,
    `    <language>${locale}</language>`,
    `    <atom:link href="${absoluteUrl(locale, feedPath)}" rel="self" type="application/rss+xml" />`,
    ...(items[0]
      ? [`    <lastBuildDate>${rfc822(items[0].date)}</lastBuildDate>`]
      : []),
    ...itemsXml,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}
