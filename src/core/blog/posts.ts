import { allPosts, type Post } from "content-collections";

import { routing } from "@/core/i18n/routing";

import siteConfig from "../../../site.config";

export type { Post };

export const blogEnabled = siteConfig.features.blog;

export const POSTS_PER_PAGE = 12;

// Site-relative paths (without the locale prefix).
export const blogPath = "/blog";
export const feedPath = "/blog/rss.xml";
export const postPath = (slug: string) => `${blogPath}/${slug}`;
/** Post share image (src/app/[locale]/(marketing)/blog/[slug]/og/route.tsx). */
export const postOgPath = (slug: string) => `${postPath(slug)}/og`;
/**
 * Site-relative path of a tag page. Tags come from frontmatter and may contain non-ASCII (`中文`)
 * or `/`, so encoding happens at the layer that builds URLs: canonical, og, sitemap, llms.txt, and
 * internal links all take it from here, so there is only one encoding.
 *
 * This encodes the URL, not the route param — the params `[tag]` receives are already decoded by
 * Next (`/blog/tags/%E4%B8%AD%E6%96%87` maps to `tag === "中文"`), and `generateStaticParams` also
 * returns raw values, so looking up posts with the result of `tagPath()` finds nothing.
 */
export const tagPath = (tag: string) =>
  `${blogPath}/tags/${encodeURIComponent(tag)}`;
/** Page n of a list. Page 1 is the list itself, without /page/1. */
export const pagePath = (base: string, page: number) =>
  page === 1 ? base : `${base}/page/${page}`;

/** Development shows drafts for previewing; in production builds (including Vercel previews and CI e2e) drafts don't exist. */
const showDrafts = process.env.NODE_ENV === "development";

const newestFirst = (a: Post, b: Post) =>
  b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug);

/**
 * Posts in a locale, newest first. Empty when blog is off or the locale is not enabled.
 * sitemap and RSS pass `drafts: false`, so they exclude drafts even in development.
 */
export function getPosts(
  locale: string,
  { drafts = showDrafts }: { drafts?: boolean } = {},
): Post[] {
  if (!blogEnabled || !routing.locales.includes(locale)) return [];
  return allPosts
    .filter((post) => post.locale === locale && (drafts || !post.draft))
    .sort(newestFirst);
}

export function getPost(locale: string, slug: string): Post | undefined {
  return getPosts(locale).find((post) => post.slug === slug);
}

/** Locales that have this post (same slug), for hreflang and the sitemap. */
export function postLocales(
  slug: string,
  options?: { drafts?: boolean },
): string[] {
  return routing.locales.filter((locale) =>
    getPosts(locale, options).some((post) => post.slug === slug),
  );
}

/** Locales with at least one published post. */
export function blogLocales(): string[] {
  return routing.locales.filter(
    (locale) => getPosts(locale, { drafts: false }).length > 0,
  );
}

/**
 * Locales a list page (`/blog` and its pages) declares in hreflang: page 1 lists every locale with
 * posts; later page numbers don't correspond across locales, so only the current locale is listed.
 *
 * Page metadata (blogIndexMetadata in pages.tsx) and the sitemap share this rule so they can't
 * disagree — tag pages are the exception: each locale has a different tag set, so only the
 * current locale is ever listed.
 */
export function listLocales(locale: string, page: number): string[] {
  return page === 1 ? blogLocales() : [locale];
}

/**
 * All tags used in a locale, sorted alphabetically. The sitemap passes `drafts: false`: tags used
 * only by drafts have no page in production (the route's generateStaticParams doesn't see them
 * either).
 */
export function getTags(
  locale: string,
  options?: { drafts?: boolean },
): string[] {
  return [
    ...new Set(getPosts(locale, options).flatMap((post) => post.tags)),
  ].sort();
}

export function getPostsByTag(locale: string, tag: string): Post[] {
  return getPosts(locale).filter((post) => post.tags.includes(tag));
}

export type PostPage = { posts: Post[]; page: number; totalPages: number };

/** Returns page `page`, or null when out of range. Page 1 is an empty list when there are no posts. */
export function paginate(posts: Post[], page: number): PostPage | null {
  const totalPages = Math.max(1, Math.ceil(posts.length / POSTS_PER_PAGE));
  if (!Number.isInteger(page) || page < 1 || page > totalPages) return null;
  const start = (page - 1) * POSTS_PER_PAGE;
  return {
    posts: posts.slice(start, start + POSTS_PER_PAGE),
    page,
    totalPages,
  };
}

/** Static params for the `/page/[page]` route: page 2 onward (page 1 is the list itself). */
export function extraPageParams(posts: Post[]): { page: string }[] {
  const totalPages = Math.ceil(posts.length / POSTS_PER_PAGE);
  return Array.from({ length: Math.max(0, totalPages - 1) }, (_, i) => ({
    page: String(i + 2),
  }));
}

/** Parses the `/page/[page]` param. Only accepts the canonical form for 2 and up; /page/1 and /page/02 return null. */
export function parsePageParam(value: string): number | null {
  return /^[1-9]\d*$/.test(value) && value !== "1" ? Number(value) : null;
}
