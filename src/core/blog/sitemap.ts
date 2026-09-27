import type { MetadataRoute } from "next";

import { absoluteUrl, languageAlternates } from "@/core/seo/urls";

import {
  blogLocales,
  blogPath,
  extraPageParams,
  getPosts,
  getTags,
  listLocales,
  pagePath,
  postLocales,
  postPath,
  tagPath,
  type Post,
} from "./posts";

type SitemapEntry = MetadataRoute.Sitemap[number];

/**
 * 一个列表（`/blog` 或某个标签）的全部页面：第 1 页是列表本身，之后是 `/page/<n>`。
 *
 * 页码来自 `extraPageParams`，和路由的 `generateStaticParams` 同源 —— 预渲染出来的页
 * 和 sitemap 里的页不会各算各的。`lastModified` 取这批文章里最新的一篇（`posts` 按
 * 日期倒序）：列表和它的翻页都随新文章变化。
 */
function listEntries(
  locale: string,
  basePath: string,
  posts: Post[],
  /** 单个页面的 hreflang 语言，与页面 metadata 同源（见 posts.ts 的 listLocales）。 */
  localesForPage: (page: number) => string[],
): MetadataRoute.Sitemap {
  const lastModified = posts[0]?.date;
  const pages = [1, ...extraPageParams(posts).map(({ page }) => Number(page))];

  return pages.map((page) => {
    const path = pagePath(basePath, page);
    return {
      url: absoluteUrl(locale, path),
      ...(lastModified && { lastModified }),
      alternates: { languages: languageAlternates(path, localesForPage(page)) },
    };
  });
}

/**
 * 博客的 sitemap 条目：列表页、翻页、标签页（含标签的翻页）和每篇已发布文章。
 * blog 关闭时为空；草稿不收录。
 *
 * 「可索引的博客页面 ⇔ sitemap 里的条目」：这里列的页面都没有 noindex
 * （见 pages.tsx 的 blogIndexMetadata / tagMetadata），反过来也不漏 —— 三组列表路由里
 * 能预渲染的页都在这，不必靠内链等爬虫发现。
 */
export function blogSitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [];

  for (const locale of blogLocales()) {
    // 草稿不收录：列表、翻页和标签都只统计已发布的文章。
    const posts = getPosts(locale, { drafts: false });

    entries.push(
      ...listEntries(locale, blogPath, posts, (page) =>
        listLocales(locale, page),
      ),
    );

    for (const tag of getTags(locale, { drafts: false })) {
      // 各语言的标签不一定相同（页面 metadata 也只声明当前语言），所以标签页的 hreflang
      // 只列自己；标签的翻页同理。
      entries.push(
        ...listEntries(
          locale,
          tagPath(tag),
          posts.filter((post) => post.tags.includes(tag)),
          () => [locale],
        ),
      );
    }

    entries.push(
      ...posts.map((post): SitemapEntry => {
        const path = postPath(post.slug);
        return {
          url: absoluteUrl(locale, path),
          lastModified: post.date,
          alternates: {
            languages: languageAlternates(
              path,
              postLocales(post.slug, { drafts: false }),
            ),
          },
        };
      }),
    );
  }

  return entries;
}
