import { allPosts, type Post } from "content-collections";

import { routing } from "@/core/i18n/routing";

import siteConfig from "../../../site.config";

export type { Post };

export const blogEnabled = siteConfig.features.blog;

export const POSTS_PER_PAGE = 12;

// 站内路径（不含语言前缀）。
export const blogPath = "/blog";
export const feedPath = "/blog/rss.xml";
export const postPath = (slug: string) => `${blogPath}/${slug}`;
/** 文章分享图（src/app/[locale]/(marketing)/blog/[slug]/og/route.tsx）。 */
export const postOgPath = (slug: string) => `${postPath(slug)}/og`;
export const tagPath = (tag: string) => `${blogPath}/tags/${tag}`;
/** 列表的第 n 页。第 1 页就是列表本身，不带 /page/1。 */
export const pagePath = (base: string, page: number) =>
  page === 1 ? base : `${base}/page/${page}`;

/** 开发环境显示草稿便于预览；生产构建（含 Vercel 预览和 CI 的 e2e）里草稿不存在。 */
const showDrafts = process.env.NODE_ENV === "development";

const newestFirst = (a: Post, b: Post) =>
  b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug);

/**
 * 某语言下的文章，按日期倒序。blog 关闭或语言未启用时为空。
 * sitemap、RSS 传 `drafts: false`，开发环境也不收录草稿。
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

/** 有这篇文章（同一 slug）的语言，用于 hreflang 和 sitemap。 */
export function postLocales(
  slug: string,
  options?: { drafts?: boolean },
): string[] {
  return routing.locales.filter((locale) =>
    getPosts(locale, options).some((post) => post.slug === slug),
  );
}

/** 至少有一篇已发布文章的语言。 */
export function blogLocales(): string[] {
  return routing.locales.filter(
    (locale) => getPosts(locale, { drafts: false }).length > 0,
  );
}

/** 某语言下用到的全部标签，按字母排序。 */
export function getTags(locale: string): string[] {
  return [...new Set(getPosts(locale).flatMap((post) => post.tags))].sort();
}

export function getPostsByTag(locale: string, tag: string): Post[] {
  return getPosts(locale).filter((post) => post.tags.includes(tag));
}

export type PostPage = { posts: Post[]; page: number; totalPages: number };

/** 取第 `page` 页；页码超出范围时返回 null。没有文章时第 1 页为空列表。 */
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

/** `/page/[page]` 路由的静态参数：第 2 页起（第 1 页是列表本身）。 */
export function extraPageParams(posts: Post[]): { page: string }[] {
  const totalPages = Math.ceil(posts.length / POSTS_PER_PAGE);
  return Array.from({ length: Math.max(0, totalPages - 1) }, (_, i) => ({
    page: String(i + 2),
  }));
}

/** 解析 `/page/[page]` 的参数。只接受 2 及以上的规范写法，/page/1、/page/02 返回 null。 */
export function parsePageParam(value: string): number | null {
  return /^[1-9]\d*$/.test(value) && value !== "1" ? Number(value) : null;
}
