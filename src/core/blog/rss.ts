import { absoluteUrl } from "@/core/seo/urls";

import { blogPath, feedPath, postPath, type Post } from "./posts";

function escapeXml(value: string) {
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

/** RSS 要求 RFC 822 日期；文章只有日期，按 UTC 零点计。 */
function rfc822(date: string) {
  return new Date(`${date}T00:00:00Z`).toUTCString();
}

export type RssFeedOptions = {
  locale: string;
  title: string;
  description: string;
  /** 已按日期倒序、不含草稿的文章。 */
  posts: Post[];
};

/** 生成 RSS 2.0。lastBuildDate 取最新文章的日期，内容不变时输出也不变。 */
export function buildRssFeed({
  locale,
  title,
  description,
  posts,
}: RssFeedOptions): string {
  const items = posts.map((post) => {
    const url = absoluteUrl(locale, postPath(post.slug));
    return [
      "    <item>",
      `      <title>${escapeXml(post.title)}</title>`,
      `      <link>${url}</link>`,
      `      <guid isPermaLink="true">${url}</guid>`,
      `      <pubDate>${rfc822(post.date)}</pubDate>`,
      `      <description>${escapeXml(post.description)}</description>`,
      ...post.tags.map((tag) => `      <category>${escapeXml(tag)}</category>`),
      "    </item>",
    ].join("\n");
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${escapeXml(title)}</title>`,
    `    <link>${absoluteUrl(locale, blogPath)}</link>`,
    `    <description>${escapeXml(description)}</description>`,
    `    <language>${locale}</language>`,
    `    <atom:link href="${absoluteUrl(locale, feedPath)}" rel="self" type="application/rss+xml" />`,
    ...(posts[0]
      ? [`    <lastBuildDate>${rfc822(posts[0].date)}</lastBuildDate>`]
      : []),
    ...items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}
