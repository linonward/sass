import type { MetadataRoute } from "next";

import { absoluteUrl, languageAlternates } from "@/core/seo/urls";

import {
  blogLocales,
  blogPath,
  getPosts,
  postLocales,
  postPath,
} from "./posts";

/** 博客列表页和每篇已发布文章的 sitemap 条目。blog 关闭时为空；草稿不收录。 */
export function blogSitemap(): MetadataRoute.Sitemap {
  const locales = blogLocales();

  const index = locales.map((locale) => ({
    url: absoluteUrl(locale, blogPath),
    alternates: { languages: languageAlternates(blogPath, locales) },
  }));

  const posts = locales.flatMap((locale) =>
    getPosts(locale, { drafts: false }).map((post) => {
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

  return [...index, ...posts];
}
