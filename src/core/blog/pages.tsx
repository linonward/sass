import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { blogNoIndex } from "@/core/config/overlay";
import { buildMetadata } from "@/core/seo/metadata";
import { ogImageSize } from "@/core/seo/og-image-size";
import { localizedPath } from "@/core/seo/urls";

import siteConfig from "../../../site.config";
import { PostArticle } from "./post-article";
import { PostList } from "./post-list";
import {
  blogEnabled,
  blogPath,
  extraPageParams,
  feedPath,
  getPost,
  getPosts,
  getPostsByTag,
  getTags,
  listLocales,
  pagePath,
  paginate,
  postLocales,
  postOgPath,
  postPath,
  tagPath,
} from "./posts";
import { buildRssFeed } from "./rss";

// The functions below are used by the pages under src/app/[locale]/(marketing)/blog/; the page
// files only read params.

async function blogTranslations(locale: string) {
  return getTranslations({ locale, namespace: "Blog" });
}

function feeds(locale: string, title: string) {
  return {
    "application/rss+xml": [{ url: localizedPath(locale, feedPath), title }],
  };
}

// —— Static params ——

export const postParams = (locale: string) =>
  getPosts(locale).map((post) => ({ slug: post.slug }));

export const blogPageParams = (locale: string) =>
  extraPageParams(getPosts(locale));

export const tagParams = (locale: string) =>
  getTags(locale).map((tag) => ({ tag }));

export const tagPageParams = (locale: string, tag: string) =>
  extraPageParams(getPostsByTag(locale, tag));

// —— List pages /blog, /blog/page/<n> ——

export async function blogIndexMetadata(locale: string, page: number) {
  const t = await blogTranslations(locale);
  const title = t("title");
  return buildMetadata({
    locale,
    path: pagePath(blogPath, page),
    title: page === 1 ? title : t("pageTitle", { title, page }),
    description: t("description"),
    // Later page numbers don't correspond across locales, so only page 1 emits hreflang (the rule
    // lives in listLocales, which the sitemap also uses).
    locales: listLocales(locale, page),
    // Locales without posts yet don't get an empty list indexed.
    noIndex: blogNoIndex() || getPosts(locale, { drafts: false }).length === 0,
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

// —— Tag pages /blog/tags/<tag>, /blog/tags/<tag>/page/<n> ——

export async function tagMetadata(locale: string, tag: string, page: number) {
  const t = await blogTranslations(locale);
  const title = t("tagTitle", { tag });
  return buildMetadata({
    locale,
    path: pagePath(tagPath(tag), page),
    title: page === 1 ? title : t("pageTitle", { title, page }),
    description: t("tagDescription", { tag, name: siteConfig.name }),
    // Tags may differ between locales, so only the current locale is emitted.
    locales: [locale],
    feeds: feeds(locale, t("feedTitle", { name: siteConfig.name })),
    noIndex: blogNoIndex(),
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

// —— Post page /blog/<slug> ——

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
    noIndex: post.draft || blogNoIndex(),
  });
}

export function PostPage({ locale, slug }: { locale: string; slug: string }) {
  const post = getPost(locale, slug) ?? notFound();
  return <PostArticle post={post} />;
}

// —— RSS /blog/rss.xml, /<locale>/blog/rss.xml ——

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
