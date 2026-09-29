import type { Changelog } from "content-collections";
import { describe, expect, test, vi } from "vitest";

import sitemap from "@/app/sitemap";
import type { SiteConfig } from "@/core/config/schema";

import siteConfig from "../../../site.config";
import { withoutSiteDomain } from "../config/testing";
import { footerNav } from "../layout/footer-nav";
import {
  changelogPath,
  entryAnchor,
  feedPath,
  getEntries,
  groupByMonth,
} from "./entries";
import { changelogFrontmatterSchema, summarize } from "./frontmatter";
import { buildChangelogFeed } from "./rss";

const origin = `https://${siteConfig.domain}`;

// 模拟多语言站点，覆盖带前缀的语言（默认语言的链接不带前缀）。
vi.mock("@/core/i18n/routing", () => ({
  routing: { locales: ["en", "de"], defaultLocale: "en" },
}));

// 条目在真实构建里由 content-collections 从 MDX 解析出来（schema 见 frontmatter.ts）；
// 这里直接喂解析后的形状，只测排序、分组、路径和 feed 的组装。
vi.mock("content-collections", () => {
  const entry = (
    slug: string,
    date: string,
    extra: Partial<Changelog> = {},
  ) => ({
    title: `Entry ${slug}`,
    date,
    category: "feature",
    description: `About ${slug} & more`,
    slug,
    mdx: "",
    _meta: {
      filePath: `${slug}.mdx`,
      fileName: `${slug}.mdx`,
      directory: ".",
      extension: "mdx",
      path: slug,
    },
    ...extra,
  });
  return {
    allPosts: [],
    allChangelogs: [
      entry("dark-mode", "2026-09-24", {
        title: "Dark mode <everywhere>",
      }),
      entry("faster-checkout", "2026-09-12", { category: "improvement" }),
      // 和上一条同一天：同日按 slug 排，输出不随构建顺序变。
      entry("twin", "2026-09-12"),
      entry("annual-invoice-fix", "2026-08-28", { category: "fix" }),
    ],
  };
});

describe("frontmatter", () => {
  test("卡片里的示例 frontmatter 通过校验，description 可以不写", () => {
    const parsed = changelogFrontmatterSchema.parse({
      title: "API Keys are here",
      date: "2026-10-15",
      category: "feature",
      content: "Users can now create their own API keys…",
    });
    expect(parsed.description).toBeUndefined();
    expect(parsed.category).toBe("feature");
  });

  test("三个类别都收，其他值拒绝", () => {
    for (const category of ["feature", "improvement", "fix"]) {
      expect(
        changelogFrontmatterSchema.safeParse({
          title: "x",
          date: "2026-01-31",
          category,
          content: "",
        }).success,
      ).toBe(true);
    }
    expect(
      changelogFrontmatterSchema.safeParse({
        title: "x",
        date: "2026-01-31",
        category: "bugfix",
        content: "",
      }).success,
    ).toBe(false);
  });

  test("date 必须是 YYYY-MM-DD，title 不能是空白", () => {
    const base = { title: "x", date: "2026-01-31", category: "fix" as const };
    expect(
      changelogFrontmatterSchema.safeParse({ ...base, date: "01/31/2026" })
        .success,
    ).toBe(false);
    expect(
      changelogFrontmatterSchema.safeParse({ ...base, title: "   " }).success,
    ).toBe(false);
    expect(
      changelogFrontmatterSchema.safeParse({ ...base, content: "" }).success,
    ).toBe(true);
  });

  test("没写 description 时从正文首段取一句", () => {
    expect(
      summarize(
        "# Heading\n\n```\ncode\n```\n\nUsers can now **rotate** keys.",
      ),
    ).toBe("Users can now rotate keys.");
    expect(summarize("- [Docs](/docs) cover it.\n\nMore text.")).toBe(
      "Docs cover it.",
    );
    expect(summarize("<Callout>JSX 行跳过</Callout>\n\n正文在下一行。")).toBe(
      "正文在下一行。",
    );
    expect(summarize("")).toBe("");
  });

  test("摘要过长时截断，尽量断在词边界", () => {
    const summary = summarize(`${"word ".repeat(60)}end`);
    expect(summary.length).toBeLessThanOrEqual(201);
    expect(summary.endsWith("…")).toBe(true);
    expect(summary).not.toContain("wor…");
  });
});

describe("entries", () => {
  test("按日期倒序，同一天按 slug 排，且不改动集合本身", () => {
    expect(getEntries().map((entry) => entry.slug)).toEqual([
      "dark-mode",
      "faster-checkout",
      "twin",
      "annual-invoice-fix",
    ]);
  });

  test("按月份分组：月份倒序，组内保持倒序", () => {
    const months = groupByMonth(getEntries());
    expect(months.map((group) => group.month)).toEqual(["2026-09", "2026-08"]);
    expect(months[0]!.entries.map((entry) => entry.slug)).toEqual([
      "dark-mode",
      "faster-checkout",
      "twin",
    ]);
    expect(months[1]!.entries.map((entry) => entry.slug)).toEqual([
      "annual-invoice-fix",
    ]);
    expect(groupByMonth([])).toEqual([]);
  });

  test("路径与锚点", () => {
    expect(changelogPath).toBe("/changelog");
    expect(feedPath).toBe("/changelog/rss.xml");
    // 更新日志是单页，每条靠锚点才有自己的地址（RSS 的 guid 用它）。
    expect(entryAnchor("dark-mode")).toBe("/changelog#dark-mode");
  });
});

describe("RSS", () => {
  const feed = (locale = "en") =>
    buildChangelogFeed({
      locale,
      title: "Acme Changelog",
      description: "New features & fixes",
      entries: getEntries(),
    });

  test("RSS 2.0：channel 和 item 的必填字段齐全", () => {
    const xml = feed();
    // 快照只锁结构和路径：域名换成占位，买家改 `domain` 时不用重跑 `-u`（同 blog.test.ts）。
    expect(withoutSiteDomain(xml)).toMatchSnapshot();

    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<rss version="2.0"');
    // channel：title / link / description 是 RSS 2.0 的必填三项，language 和 self 链接跟着走。
    expect(xml).toContain("<title>Acme Changelog</title>");
    expect(xml).toContain(`<link>${origin}/changelog</link>`);
    expect(xml).toContain(
      "<description>New features &amp; fixes</description>",
    );
    expect(xml).toContain("<language>en</language>");
    expect(xml).toContain(
      `<atom:link href="${origin}/changelog/rss.xml" rel="self" type="application/rss+xml" />`,
    );
    // 一条 item 至少有 title / link / guid / pubDate / description（RSS 要求 title 或 description）。
    const first = xml.slice(xml.indexOf("<item>"), xml.indexOf("</item>"));
    for (const tag of ["title", "link", "guid", "pubDate", "description"]) {
      expect(first).toContain(`<${tag}`);
    }
  });

  test("条目的 link 和 guid 是页面上的锚点，互不相同", () => {
    const xml = feed();
    expect(xml).toContain(`<link>${origin}/changelog#dark-mode</link>`);
    expect(xml).toContain(
      `<guid isPermaLink="true">${origin}/changelog#dark-mode</guid>`,
    );
    expect(xml).toContain("<pubDate>Thu, 24 Sep 2026 00:00:00 GMT</pubDate>");
    // 类别输出成 <category>。
    expect(xml).toContain("<category>improvement</category>");
    expect(xml).toContain("<category>fix</category>");

    const guids = [...xml.matchAll(/<guid[^>]*>([^<]+)<\/guid>/g)].map(
      (match) => match[1],
    );
    expect(guids).toHaveLength(4);
    expect(new Set(guids).size).toBe(4);
  });

  test("转义标题里的 XML 字符", () => {
    expect(feed()).toContain("<title>Dark mode &lt;everywhere&gt;</title>");
    expect(feed()).toContain(
      "<description>About dark-mode &amp; more</description>",
    );
  });

  test("其他语言的链接带语言前缀", () => {
    const xml = feed("de");
    expect(xml).toContain(`<link>${origin}/de/changelog</link>`);
    expect(xml).toContain(`<link>${origin}/de/changelog#twin</link>`);
    expect(xml).toContain("<language>de</language>");
  });
});

describe("sitemap", () => {
  test("changelog 开启时 /changelog 进入 sitemap，带 hreflang", () => {
    // 整个 sitemap 的快照在 src/core/seo/seo.test.ts；这里只看 changelog 这一条。
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toContain(`${origin}/changelog`);
    expect(urls).toContain(`${origin}/de/changelog`);
    expect(
      sitemap().find((entry) => entry.url === `${origin}/changelog`)?.alternates
        ?.languages,
    ).toEqual({
      en: `${origin}/changelog`,
      de: `${origin}/de/changelog`,
      "x-default": `${origin}/changelog`,
    });
  });
});

describe("footerNav", () => {
  test("开关开启时页脚显示 changelog 入口", () => {
    const product = footerNav(siteConfig).find(
      (group) => group.key === "product",
    );
    expect(product?.links.map((link) => link.href)).toContain(changelogPath);
  });

  test("开关关闭时入口消失，其余分组和链接原样保留", () => {
    const disabled: SiteConfig = {
      ...siteConfig,
      changelog: { enabled: false },
    };
    const groups = footerNav(disabled);

    expect(groups.map((group) => group.key)).toEqual(
      siteConfig.nav.footer.map((group) => group.key),
    );
    expect(
      groups.flatMap((group) => group.links.map((link) => link.href)),
    ).not.toContain(changelogPath);
    // 同一组里的其他链接一个不少。
    expect(
      groups.find((group) => group.key === "product")?.links.map((l) => l.href),
    ).toEqual(["/#features", "/pricing", "/#faq", "/blog"]);
  });
});
