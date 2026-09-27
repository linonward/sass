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

/** RSS 要求 RFC 822 日期；条目只有日期，按 UTC 零点计。 */
function rfc822(date: string) {
  return new Date(`${date}T00:00:00Z`).toUTCString();
}

export type RssItem = {
  title: string;
  /** 条目的站内路径（不含语言前缀），例如 `/blog/hello-world`。同时用作 link 和 guid。 */
  path: string;
  /** 发布日期，例如 `2026-01-31`。 */
  date: string;
  description: string;
  /** 可选分类，输出成多个 `<category>`（博客的标签、changelog 的类别）。 */
  categories?: readonly string[];
};

export type RssFeedOptions = {
  locale: string;
  title: string;
  description: string;
  /** 列表页的站内路径（不含语言前缀），作为频道的 link。 */
  pagePath: string;
  /** feed 自己的站内路径（不含语言前缀），用于 `atom:link rel="self"`。 */
  feedPath: string;
  /** 已按日期倒序的条目。 */
  items: readonly RssItem[];
};

/** 生成 RSS 2.0。lastBuildDate 取最新条目的日期，内容不变时输出也不变。 */
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
