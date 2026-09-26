import { describe, expect, test, vi } from "vitest";

import robots from "@/app/robots";
import sitemap from "@/app/sitemap";

import siteConfig from "../../../site.config";
import { withoutSiteDomain } from "../config/testing";
import { serializeJsonLd } from "./json-ld";
import { buildMetadata } from "./metadata";
import { languageAlternates, localizedPath } from "./urls";

// 模拟多语言站点，覆盖带前缀的语言。
vi.mock("@/core/i18n/routing", () => ({
  routing: { locales: ["en", "de"], defaultLocale: "en" },
}));

// 博客条目在 src/core/blog/blog.test.ts 里用固定数据测试，这里不受示例文章影响。
vi.mock("content-collections", () => ({ allPosts: [] }));

const origin = `https://${siteConfig.domain}`;

describe("urls", () => {
  test.each([
    ["en", "/", "/"],
    ["en", "/privacy", "/privacy"],
    ["de", "/", "/de"],
    ["de", "/privacy", "/de/privacy"],
  ])("%s %s → %s", (locale, path, expected) => {
    expect(localizedPath(locale, path)).toBe(expected);
  });

  test("只有部分语言的页面，x-default 优先指向默认语言", () => {
    expect(languageAlternates("/blog/a", ["de"])).toEqual({
      de: `${origin}/de/blog/a`,
      "x-default": `${origin}/de/blog/a`,
    });
    expect(languageAlternates("/blog/a", [])).toEqual({});
  });

  test("hreflang 包含每个语言和 x-default", () => {
    expect(languageAlternates("/privacy")).toEqual({
      en: `${origin}/privacy`,
      de: `${origin}/de/privacy`,
      "x-default": `${origin}/privacy`,
    });
  });
});

describe("buildMetadata", () => {
  test("首页使用站点名和标题模板", () => {
    const metadata = buildMetadata({ locale: "de", path: "/" });
    expect(metadata.title).toEqual({
      default: siteConfig.name,
      template: `%s | ${siteConfig.name}`,
    });
    expect(metadata.alternates?.canonical).toBe(`${origin}/de`);
    expect(metadata.openGraph).toMatchObject({
      url: `${origin}/de`,
      locale: "de",
      images: [{ url: "/opengraph-image", width: 1200, height: 630 }],
    });
  });

  test("子页面套用模板并可覆盖描述和分享图", () => {
    const metadata = buildMetadata({
      locale: "en",
      path: "/privacy",
      title: "Privacy Policy",
      description: "How we handle data.",
      image: "/privacy-og.png",
    });
    expect(metadata.title).toEqual({
      absolute: `Privacy Policy | ${siteConfig.name}`,
    });
    expect(metadata.description).toBe("How we handle data.");
    expect(metadata.alternates?.canonical).toBe(`${origin}/privacy`);
    expect(metadata.openGraph).toMatchObject({
      title: `Privacy Policy | ${siteConfig.name}`,
      images: [{ url: "/privacy-og.png" }],
    });
    expect(metadata.robots).toBeUndefined();
  });

  test("noIndex 关闭收录", () => {
    const metadata = buildMetadata({ locale: "en", path: "/x", noIndex: true });
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});

describe("sitemap", () => {
  test("营销路由 × 语言，带 hreflang", () => {
    expect(withoutSiteDomain(sitemap())).toMatchSnapshot();
  });
});

describe("robots", () => {
  test("禁止抓取 API、dashboard、admin（含语言前缀）并指向 sitemap", () => {
    expect(withoutSiteDomain(robots())).toMatchSnapshot();
  });
});

describe("serializeJsonLd", () => {
  test("转义可以闭合 script 标签的字符", () => {
    const json = serializeJsonLd({
      name: "</script><script>alert(1)</script>&",
    });
    expect(json).not.toContain("<");
    expect(json).not.toContain(">");
    expect(JSON.parse(json)).toEqual({
      name: "</script><script>alert(1)</script>&",
    });
  });
});
