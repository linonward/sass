import { buildRssFeed as buildFeed } from "@/core/seo/rss";

import { blogPath, feedPath, postPath, type Post } from "./posts";

export type RssFeedOptions = {
  locale: string;
  title: string;
  description: string;
  /** Posts sorted newest first, excluding drafts. */
  posts: Post[];
};

/** The blog's RSS 2.0: items come from posts; links and categories (tags) are built on `/blog`. */
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
