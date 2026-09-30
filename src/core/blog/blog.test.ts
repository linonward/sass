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

// A non-ASCII tag: tag URLs must be percent-encoded exactly once. vi.hoisted so the mock factories
// below can use it too.
const nonAsciiTag = vi.hoisted(() => "中文"); // english-check-allow: the non-ASCII test tag

// Simulates a multilingual site: en has 13 posts (paginated) and 1 draft, de has only 1
// translation, fr is not enabled. All 13 carry the guides tag, so the tag page itself paginates too
// (/blog/tags/guides/page/2).
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
        tags: ["news", "guides", nonAsciiTag],
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
  test("sorted newest first; excludes drafts in production (non-development)", () => {
    const posts = getPosts("en");
    expect(posts).toHaveLength(14);
    expect(posts[0]!.slug).toBe("hello");
    expect(posts.at(-1)!.slug).toBe("post-1");
    expect(getPost("en", "secret")).toBeUndefined();
    expect(getPosts("en", { drafts: true })[0]!.slug).toBe("secret");
  });

  test("a locale that is not enabled has no posts", () => {
    expect(getPosts("fr")).toEqual([]);
  });

  test("tags come only from visible posts", () => {
    expect(getTags("en")).toEqual(["guides", "news", nonAsciiTag]);
    expect(getTags("de")).toEqual(["news"]);
    // sitemap passes drafts: false (the default) — tags used only by drafts have no page in production.
    expect(getTags("en", { drafts: true })).toEqual([
      "drafts-only",
      "guides",
      "news",
      nonAsciiTag,
    ]);
  });

  test("translations of the same slug", () => {
    expect(postLocales("hello")).toEqual(["en", "de"]);
    expect(postLocales("post-1")).toEqual(["en"]);
  });
});

describe("paths", () => {
  test("tag paths are encoded once: non-ASCII and / stay inside a single route segment", () => {
    expect(tagPath("guides")).toBe("/blog/tags/guides");
    expect(tagPath(nonAsciiTag)).toBe("/blog/tags/%E4%B8%AD%E6%96%87");
    expect(tagPath("a/b")).toBe("/blog/tags/a%2Fb");

    // canonical, og, sitemap, internal links, and pagination are all built on tagPath: there is only
    // one encoding, so pages and machine-readable listings can't disagree on percent-encoding.
    expect(pagePath(tagPath(nonAsciiTag), 1)).toBe(
      "/blog/tags/%E4%B8%AD%E6%96%87",
    );
    expect(pagePath(tagPath(nonAsciiTag), 2)).toBe(
      "/blog/tags/%E4%B8%AD%E6%96%87/page/2",
    );
    expect(absoluteUrl("en", tagPath(nonAsciiTag))).toBe(
      `${origin}/blog/tags/%E4%B8%AD%E6%96%87`,
    );
  });
});

describe("pagination", () => {
  const posts = getPosts("en");

  test(`${POSTS_PER_PAGE} posts per page, null when out of range`, () => {
    expect(paginate(posts, 1)).toMatchObject({ page: 1, totalPages: 2 });
    expect(paginate(posts, 1)!.posts).toHaveLength(12);
    expect(paginate(posts, 2)!.posts).toHaveLength(2);
    expect(paginate(posts, 3)).toBeNull();
    expect(paginate(posts, 0)).toBeNull();
  });

  test("page 1 is an empty list when there are no posts", () => {
    expect(paginate([], 1)).toEqual({ posts: [], page: 1, totalPages: 1 });
    expect(extraPageParams([])).toEqual([]);
  });

  test("/page/[page] starts at page 2 and only accepts the canonical form", () => {
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

  test("blog index, pagination, tag pages, and published posts; hreflang lists only translated locales", () => {
    expect(withoutSiteDomain(blogSitemap())).toMatchSnapshot();
  });

  test("all three list route groups are in the sitemap (indexable ⇔ in sitemap)", () => {
    const urls = entries().map((entry) => entry.url);

    // /blog and its pages (same source as the route's generateStaticParams).
    expect(urls).toContain(`${origin}/blog`);
    expect(urls).toContain(`${origin}/blog/page/2`);
    expect(urls).not.toContain(`${origin}/blog/page/3`);

    // /blog/tags/<tag> and the tag's own pages.
    expect(urls).toContain(`${origin}/blog/tags/news`);
    expect(urls).toContain(`${origin}/blog/tags/guides`);
    expect(urls).toContain(`${origin}/blog/tags/guides/page/2`);
    expect(urls).not.toContain(`${origin}/de/blog/tags/guides`);

    // Tag paths are encoded: canonical uses the same tagPath, so the two can't disagree on
    // percent-encoding.
    expect(urls).toContain(
      `${origin}/blog/tags/${encodeURIComponent(nonAsciiTag)}`,
    );
    expect(urls.some((url) => url.includes(`/blog/tags/${nonAsciiTag}`))).toBe(
      false,
    );
  });

  test("excludes drafts and tags used only by drafts", () => {
    const urls = entries().map((entry) => entry.url);
    expect(urls.some((url) => url.includes("secret"))).toBe(false);
    expect(urls.some((url) => url.includes("drafts-only"))).toBe(false);
  });

  test("list page hreflang shares its source with page metadata (listLocales in posts.ts)", () => {
    // Page 1: every locale with posts. Later page numbers don't correspond across locales, so only
    // the current locale is listed.
    expect(languages(`${origin}/blog`)).toEqual({
      en: `${origin}/blog`,
      de: `${origin}/de/blog`,
      "x-default": `${origin}/blog`,
    });
    expect(languages(`${origin}/blog/page/2`)).toEqual({
      en: `${origin}/blog/page/2`,
      "x-default": `${origin}/blog/page/2`,
    });
    // Each locale has its own set of tags, so only the current locale is ever listed.
    expect(languages(`${origin}/blog/tags/news`)).toEqual({
      en: `${origin}/blog/tags/news`,
      "x-default": `${origin}/blog/tags/news`,
    });
    expect(languages(`${origin}/de/blog/tags/news`)).toEqual({
      de: `${origin}/de/blog/tags/news`,
      "x-default": `${origin}/de/blog/tags/news`,
    });
  });

  test("lastModified is the newest post in that list", () => {
    const list = entries().find((entry) => entry.url === `${origin}/blog`);
    expect(list?.lastModified).toBe("2026-02-01");
    const tag = entries().find(
      (entry) => entry.url === `${origin}/blog/tags/news`,
    );
    expect(tag?.lastModified).toBe("2026-02-01");
  });

  test("is merged into app/sitemap.ts", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toContain(`https://${siteConfig.domain}/blog/hello`);
    expect(urls).toContain(`https://${siteConfig.domain}/de/blog/hello`);
    expect(urls.some((url) => url.includes("secret"))).toBe(false);
  });
});

describe("RSS", () => {
  test("RSS 2.0 output, escapes titles and descriptions", () => {
    const xml = buildRssFeed({
      locale: "de",
      title: "Acme Blog",
      description: "News & updates",
      posts: getPosts("de", { drafts: false }),
    });
    expect(withoutSiteDomain(xml)).toMatchSnapshot();
  });

  test("default-locale links have no prefix and drafts are omitted", () => {
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
