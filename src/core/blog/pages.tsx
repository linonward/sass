import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { buildMetadata } from "@/core/seo/metadata";
import { ogImageSize } from "@/core/seo/og-image-size";
import { localizedPath } from "@/core/seo/urls";

import siteConfig from "../../../site.config";
import { PostArticle } from "./post-article";
import { PostList } from "./post-list";
import {
  blogEnabled,
  blogLocales,
  blogPath,
  extraPageParams,
  feedPath,
  getPost,
  getPosts,
  getPostsByTag,
  getTags,
  pagePath,
  paginate,
  postLocales,
  postOgPath,
  postPath,
  tagPath,
} from "./posts";
import { buildRssFeed } from "./rss";

// 以下函数供 src/app/[locale]/(marketing)/blog/ 下的页面使用，页面文件只负责取 params。

async function blogTranslations(locale: string) {
  return getTranslations({ locale, namespace: "Blog" });
}

function feeds(locale: string, title: string) {
  return {
    "application/rss+xml": [{ url: localizedPath(locale, feedPath), title }],
  };
}

// —— 静态参数 ——

export const postParams = (locale: string) =>
  getPosts(locale).map((post) => ({ slug: post.slug }));

export const blogPageParams = (locale: string) =>
  extraPageParams(getPosts(locale));

export const tagParams = (locale: string) =>
  getTags(locale).map((tag) => ({ tag }));

export const tagPageParams = (locale: string, tag: string) =>
  extraPageParams(getPostsByTag(locale, tag));

// —— 列表页 /blog、/blog/page/<n> ——

export async function blogIndexMetadata(locale: string, page: number) {
  const t = await blogTranslations(locale);
  const title = t("title");
  return buildMetadata({
    locale,
    path: pagePath(blogPath, page),
    title: page === 1 ? title : t("pageTitle", { title, page }),
    description: t("description"),
    // 翻页后的页码在各语言间不对应，只有第 1 页输出 hreflang。
    locales: page === 1 ? blogLocales() : [locale],
    // 还没有文章的语言不收录空列表。
    noIndex: getPosts(locale, { drafts: false }).length === 0,
    feeds: feeds(locale, t("feedTitle", { name: siteConfig.name })),
  });
}

export async function BlogIndex({
  locale,
  page,
}: {
  locale: string;
  page: number;
}) {
  if (!blogEnabled) notFound();
  const data = paginate(getPosts(locale), page) ?? notFound();
  const t = await blogTranslations(locale);
  return (
    <PostList
      title={t("title")}
      description={t("description")}
      basePath={blogPath}
      data={data}
    />
  );
}

// —— 标签页 /blog/tags/<tag>、/blog/tags/<tag>/page/<n> ——

export async function tagMetadata(locale: string, tag: string, page: number) {
  const t = await blogTranslations(locale);
  const title = t("tagTitle", { tag });
  return buildMetadata({
    locale,
    path: pagePath(tagPath(tag), page),
    title: page === 1 ? title : t("pageTitle", { title, page }),
    description: t("tagDescription", { tag, name: siteConfig.name }),
    // 各语言的标签不一定相同，只输出当前语言。
    locales: [locale],
    feeds: feeds(locale, t("feedTitle", { name: siteConfig.name })),
  });
}

export async function TagIndex({
  locale,
  tag,
  page,
}: {
  locale: string;
  tag: string;
  page: number;
}) {
  const posts = getPostsByTag(locale, tag);
  if (posts.length === 0) notFound();
  const data = paginate(posts, page) ?? notFound();
  const t = await blogTranslations(locale);
  return (
    <PostList
      title={t("tagTitle", { tag })}
      description={t("tagDescription", { tag, name: siteConfig.name })}
      basePath={tagPath(tag)}
      data={data}
    />
  );
}

// —— 文章页 /blog/<slug> ——

export async function postMetadata(locale: string, slug: string) {
  const post = getPost(locale, slug);
  if (!post) return {};
  return buildMetadata({
    locale,
    path: postPath(slug),
    title: post.title,
    description: post.description,
    image: {
      url: localizedPath(locale, postOgPath(slug)),
      ...ogImageSize,
      alt: post.title,
    },
    locales: postLocales(slug),
    article: { publishedTime: post.date, tags: post.tags },
    noIndex: post.draft,
  });
}

export function PostPage({ locale, slug }: { locale: string; slug: string }) {
  const post = getPost(locale, slug) ?? notFound();
  return <PostArticle post={post} />;
}

// —— RSS /blog/rss.xml、/<locale>/blog/rss.xml ——

export async function rssResponse(locale: string) {
  if (!blogEnabled) return new Response("Not Found", { status: 404 });
  const t = await blogTranslations(locale);
  const xml = buildRssFeed({
    locale,
    title: t("feedTitle", { name: siteConfig.name }),
    description: t("description"),
    posts: getPosts(locale, { drafts: false }),
  });
  return new Response(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
