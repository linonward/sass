import type { Post } from "content-collections";
import { describe, expect, test, vi } from "vitest";

import sitemap from "@/app/sitemap";

import siteConfig from "../../../site.config";
import { withoutSiteDomain } from "../config/testing";
import {
  extraPageParams,
  getPost,
  getPosts,
  getTags,
  paginate,
  parsePageParam,
  POSTS_PER_PAGE,
  postLocales,
} from "./posts";
import { buildRssFeed } from "./rss";
import { blogSitemap } from "./sitemap";

// 模拟多语言站点：en 有 13 篇文章（翻页）和 1 篇草稿，de 只有 1 篇翻译，fr 未启用。
vi.mock("@/core/i18n/routing", () => ({
  routing: { locales: ["en", "de"], defaultLocale: "en" },
}));

vi.mock("content-collections", () => {
  const post = (
    locale: string,
    slug: string,
    date: string,
    extra: Partial<Post> = {},
  ) => ({
    title: `Post ${slug}`,
    description: `About ${slug} & more`,
    date,
    tags: [],
    draft: false,
    locale,
    slug,
    mdx: "",
    _meta: {
      filePath: `${locale}/${slug}.mdx`,
      fileName: `${slug}.mdx`,
      directory: locale,
      extension: "mdx",
      path: `${locale}/${slug}`,
    },
    ...extra,
  });
  return {
    allPosts: [
      ...Array.from({ length: 13 }, (_, i) =>
        post(
          "en",
          `post-${i + 1}`,
          `2026-01-${String(i + 1).padStart(2, "0")}`,
        ),
      ),
      post("en", "hello", "2026-02-01", {
        title: "Hello <world>",
        tags: ["news", "guides"],
      }),
      post("en", "secret", "2026-03-01", { draft: true, tags: ["news"] }),
      post("de", "hello", "2026-02-02", { title: "Hallo", tags: ["news"] }),
      post("fr", "bonjour", "2026-02-03"),
    ],
  };
});

describe("posts", () => {
  test("按日期倒序，生产环境（非 development）不含草稿", () => {
    const posts = getPosts("en");
    expect(posts).toHaveLength(14);
    expect(posts[0]!.slug).toBe("hello");
    expect(posts.at(-1)!.slug).toBe("post-1");
    expect(getPost("en", "secret")).toBeUndefined();
    expect(getPosts("en", { drafts: true })[0]!.slug).toBe("secret");
  });

  test("未启用的语言没有文章", () => {
    expect(getPosts("fr")).toEqual([]);
  });

  test("标签只来自可见的文章", () => {
    expect(getTags("en")).toEqual(["guides", "news"]);
    expect(getTags("de")).toEqual(["news"]);
  });

  test("同一 slug 的翻译", () => {
    expect(postLocales("hello")).toEqual(["en", "de"]);
    expect(postLocales("post-1")).toEqual(["en"]);
  });
});

describe("分页", () => {
  const posts = getPosts("en");

  test(`每页 ${POSTS_PER_PAGE} 篇，超出范围返回 null`, () => {
    expect(paginate(posts, 1)).toMatchObject({ page: 1, totalPages: 2 });
    expect(paginate(posts, 1)!.posts).toHaveLength(12);
    expect(paginate(posts, 2)!.posts).toHaveLength(2);
    expect(paginate(posts, 3)).toBeNull();
    expect(paginate(posts, 0)).toBeNull();
  });

  test("没有文章时第 1 页是空列表", () => {
    expect(paginate([], 1)).toEqual({ posts: [], page: 1, totalPages: 1 });
    expect(extraPageParams([])).toEqual([]);
  });

  test("/page/[page] 从第 2 页开始，只接受规范写法", () => {
    expect(extraPageParams(posts)).toEqual([{ page: "2" }]);
    expect(parsePageParam("2")).toBe(2);
    for (const value of ["1", "0", "02", "2a", ""]) {
      expect(parsePageParam(value)).toBeNull();
    }
  });
});

describe("sitemap", () => {
  test("博客列表和已发布文章，hreflang 只列出有翻译的语言", () => {
    expect(withoutSiteDomain(blogSitemap())).toMatchSnapshot();
  });

  test("合并进 app/sitemap.ts", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toContain(`https://${siteConfig.domain}/blog/hello`);
    expect(urls).toContain(`https://${siteConfig.domain}/de/blog/hello`);
    expect(urls.some((url) => url.includes("secret"))).toBe(false);
  });
});

describe("RSS", () => {
  test("RSS 2.0 输出，转义标题和描述", () => {
    const xml = buildRssFeed({
      locale: "de",
      title: "Acme Blog",
      description: "News & updates",
      posts: getPosts("de", { drafts: false }),
    });
    expect(withoutSiteDomain(xml)).toMatchSnapshot();
  });

  test("默认语言的链接不带前缀，草稿不出现", () => {
    const xml = buildRssFeed({
      locale: "en",
      title: "Acme Blog",
      description: "News",
      posts: getPosts("en", { drafts: false }),
    });
    expect(xml).toContain(
      `<link>https://${siteConfig.domain}/blog/hello</link>`,
    );
    expect(xml).toContain("<title>Hello &lt;world&gt;</title>");
    expect(xml).not.toContain("secret");
    expect(xml.match(/<item>/g)).toHaveLength(14);
  });
});
