import type { Post } from "content-collections";
import { describe, expect, test, vi } from "vitest";

import sitemap from "@/app/sitemap";

import siteConfig from "../../../site.config";
import { withoutSiteDomain } from "../config/testing";
import { absoluteUrl } from "../seo/urls";
import {
  extraPageParams,
  getPost,
  getPosts,
  getTags,
  pagePath,
  paginate,
  parsePageParam,
  POSTS_PER_PAGE,
  postLocales,
  tagPath,
} from "./posts";
import { buildRssFeed } from "./rss";
import { blogSitemap } from "./sitemap";

const origin = `https://${siteConfig.domain}`;

// 模拟多语言站点：en 有 13 篇文章（翻页）和 1 篇草稿，de 只有 1 篇翻译，fr 未启用。
// 13 篇都带 guides 标签：标签页本身也要能翻页（/blog/tags/guides/page/2）。
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
          { tags: ["guides"] },
        ),
      ),
      post("en", "hello", "2026-02-01", {
        title: "Hello <world>",
        tags: ["news", "guides", "中文"],
      }),
      post("en", "secret", "2026-03-01", {
        draft: true,
        tags: ["news", "drafts-only"],
      }),
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
    expect(getTags("en")).toEqual(["guides", "news", "中文"]);
    expect(getTags("de")).toEqual(["news"]);
    // sitemap 传 drafts: false（默认）—— 只有草稿用到的标签在生产里没有页面。
    expect(getTags("en", { drafts: true })).toEqual([
      "drafts-only",
      "guides",
      "news",
      "中文",
    ]);
  });

  test("同一 slug 的翻译", () => {
    expect(postLocales("hello")).toEqual(["en", "de"]);
    expect(postLocales("post-1")).toEqual(["en"]);
  });
});

describe("路径", () => {
  test("标签路径编码一次：非 ASCII 和 / 都留在单个路由段里", () => {
    expect(tagPath("guides")).toBe("/blog/tags/guides");
    expect(tagPath("中文")).toBe("/blog/tags/%E4%B8%AD%E6%96%87");
    expect(tagPath("a/b")).toBe("/blog/tags/a%2Fb");

    // canonical、og、sitemap、内链和翻页都拼在 tagPath 之上：编码只有这一份，
    // 页面和机器可读的清单不会一个带 % 一个不带。
    expect(pagePath(tagPath("中文"), 1)).toBe("/blog/tags/%E4%B8%AD%E6%96%87");
    expect(pagePath(tagPath("中文"), 2)).toBe(
      "/blog/tags/%E4%B8%AD%E6%96%87/page/2",
    );
    expect(absoluteUrl("en", tagPath("中文"))).toBe(
      `${origin}/blog/tags/%E4%B8%AD%E6%96%87`,
    );
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
  const entries = () => blogSitemap();
  const languages = (url: string) =>
    entries().find((entry) => entry.url === url)?.alternates?.languages;

  test("博客列表、翻页、标签页和已发布文章，hreflang 只列出有翻译的语言", () => {
    expect(withoutSiteDomain(blogSitemap())).toMatchSnapshot();
  });

  test("三组列表路由都在 sitemap 里（可索引 ⇔ 在 sitemap）", () => {
    const urls = entries().map((entry) => entry.url);

    // /blog 与它的翻页（和路由的 generateStaticParams 同源）。
    expect(urls).toContain(`${origin}/blog`);
    expect(urls).toContain(`${origin}/blog/page/2`);
    expect(urls).not.toContain(`${origin}/blog/page/3`);

    // /blog/tags/<tag> 与标签自己的翻页。
    expect(urls).toContain(`${origin}/blog/tags/news`);
    expect(urls).toContain(`${origin}/blog/tags/guides`);
    expect(urls).toContain(`${origin}/blog/tags/guides/page/2`);
    expect(urls).not.toContain(`${origin}/de/blog/tags/guides`);

    // 标签路径带编码：canonical 走的是同一个 tagPath，两边不会一个带 % 一个不带。
    expect(urls).toContain(`${origin}/blog/tags/${encodeURIComponent("中文")}`);
    expect(urls.some((url) => url.includes("/blog/tags/中文"))).toBe(false);
  });

  test("草稿和只有草稿用到的标签都不收录", () => {
    const urls = entries().map((entry) => entry.url);
    expect(urls.some((url) => url.includes("secret"))).toBe(false);
    expect(urls.some((url) => url.includes("drafts-only"))).toBe(false);
  });

  test("列表页的 hreflang 与页面 metadata 同源（posts.ts 的 listLocales）", () => {
    // 第 1 页：所有有文章的语言。翻页后页码在各语言间不对应，只列当前语言。
    expect(languages(`${origin}/blog`)).toEqual({
      en: `${origin}/blog`,
      de: `${origin}/de/blog`,
      "x-default": `${origin}/blog`,
    });
    expect(languages(`${origin}/blog/page/2`)).toEqual({
      en: `${origin}/blog/page/2`,
      "x-default": `${origin}/blog/page/2`,
    });
    // 标签是各语言自己的一套，始终只列当前语言。
    expect(languages(`${origin}/blog/tags/news`)).toEqual({
      en: `${origin}/blog/tags/news`,
      "x-default": `${origin}/blog/tags/news`,
    });
    expect(languages(`${origin}/de/blog/tags/news`)).toEqual({
      de: `${origin}/de/blog/tags/news`,
      "x-default": `${origin}/de/blog/tags/news`,
    });
  });

  test("lastModified 取该列表里最新的一篇文章", () => {
    const list = entries().find((entry) => entry.url === `${origin}/blog`);
    expect(list?.lastModified).toBe("2026-02-01");
    const tag = entries().find(
      (entry) => entry.url === `${origin}/blog/tags/news`,
    );
    expect(tag?.lastModified).toBe("2026-02-01");
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
