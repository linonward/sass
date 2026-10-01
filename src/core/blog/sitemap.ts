import type { MetadataRoute } from "next";

import { blogNoIndex } from "@/core/config/overlay";
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
 * All pages of a list (`/blog` or a tag): page 1 is the list itself, then `/page/<n>`.
 *
 * Page numbers come from `extraPageParams`, the same source as the route's `generateStaticParams`
 * — prerendered pages and sitemap pages can't be computed differently. `lastModified` is the newest
 * post in the batch (`posts` is sorted newest first): a list and its pages all change with new
 * posts.
 */
function listEntries(
  locale: string,
  basePath: string,
  posts: Post[],
  /** hreflang locales for a single page, same source as page metadata (see listLocales in posts.ts). */
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
 * Blog sitemap entries: the index, its pages, tag pages (including their pages), and every
 * published post. Empty when blog is off or the site overlay marks it noindex; drafts are excluded.
 *
 * "Indexable blog pages ⇔ sitemap entries": none of the pages listed here are noindex (see
 * blogIndexMetadata / tagMetadata in pages.tsx), and nothing is missed the other way — every
 * prerenderable page of the three list route groups is here, so crawlers don't have to discover
 * them through internal links.
 */
export function blogSitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [];
  if (blogNoIndex()) return entries;

  for (const locale of blogLocales()) {
    // Drafts are excluded: lists, pages, and tags only count published posts.
    const posts = getPosts(locale, { drafts: false });

    entries.push(
      ...listEntries(locale, blogPath, posts, (page) =>
        listLocales(locale, page),
      ),
    );

    for (const tag of getTags(locale, { drafts: false })) {
      // Tags may differ between locales (page metadata also declares only the current locale), so
      // a tag page's hreflang lists only itself; the same goes for the tag's pages.
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
