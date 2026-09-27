import { buildRssFeed as buildFeed } from "@/core/seo/rss";

import { blogPath, feedPath, postPath, type Post } from "./posts";

export type RssFeedOptions = {
  locale: string;
  title: string;
  description: string;
  /** 已按日期倒序、不含草稿的文章。 */
  posts: Post[];
};

/** 博客的 RSS 2.0：条目来自文章，链接和分类（标签）都拼在 `/blog` 上。 */
export function buildRssFeed({
  locale,
  title,
  description,
  posts,
}: RssFeedOptions): string {
  return buildFeed({
    locale,
    title,
    description,
    pagePath: blogPath,
    feedPath,
    items: posts.map((post) => ({
      title: post.title,
      path: postPath(post.slug),
      date: post.date,
      description: post.description,
      categories: post.tags,
    })),
  });
}
