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
/**
 * 标签页的站内路径。标签来自 frontmatter，可能含非 ASCII（`中文`）或 `/`，所以拼 URL
 * 的这一层做编码：canonical、og、sitemap、llms.txt 和内链都从这里取，编码只有一份。
 *
 * 编的是 URL，不是路由参数 —— `[tag]` 拿到的 params 已经过 Next 解码
 * （`/blog/tags/%E4%B8%AD%E6%96%87` 对应 `tag === "中文"`），`generateStaticParams`
 * 返回的也是原值，用 `tagPath()` 的结果去查文章会查不到。
 */
export const tagPath = (tag: string) =>
  `${blogPath}/tags/${encodeURIComponent(tag)}`;
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

/**
 * 列表页（`/blog` 和它的翻页）声明 hreflang 的语言：第 1 页列出所有有文章的语言，
 * 翻页后的页码在各语言间不对应，只列当前语言。
 *
 * 页面 metadata（pages.tsx 的 blogIndexMetadata）和 sitemap 共用这一条，两边才不会
 * 各说各话 —— 标签页是例外，各语言的标签集合不同，始终只列当前语言。
 */
export function listLocales(locale: string, page: number): string[] {
  return page === 1 ? blogLocales() : [locale];
}

/**
 * 某语言下用到的全部标签，按字母排序。sitemap 传 `drafts: false`：只有草稿用到的标签
 * 在生产里没有页面（路由的 generateStaticParams 也收不到它）。
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
