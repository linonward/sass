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

// Simulates a multilingual site to cover prefixed locales (default-locale links have no prefix).
vi.mock("@/core/i18n/routing", () => ({
  routing: { locales: ["en", "de"], defaultLocale: "en" },
}));

// In a real build, content-collections parses entries from MDX (schema in frontmatter.ts); here we
// feed the parsed shape directly and only test sorting, grouping, paths, and feed assembly.
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
      // Same day as the previous one: same-day entries sort by slug, so output doesn't depend on build order.
      entry("twin", "2026-09-12"),
      entry("annual-invoice-fix", "2026-08-28", { category: "fix" }),
    ],
  };
});

describe("frontmatter", () => {
  test("the example frontmatter passes validation; description is optional", () => {
    const parsed = changelogFrontmatterSchema.parse({
      title: "API Keys are here",
      date: "2026-10-15",
      category: "feature",
      content: "Users can now create their own API keys…",
    });
    expect(parsed.description).toBeUndefined();
    expect(parsed.category).toBe("feature");
  });

  test("accepts all three categories and rejects other values", () => {
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

  test("date must be YYYY-MM-DD and title cannot be blank", () => {
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

  test("takes a sentence from the first body paragraph when description is missing", () => {
    expect(
      summarize(
        "# Heading\n\n```\ncode\n```\n\nUsers can now **rotate** keys.",
      ),
    ).toBe("Users can now rotate keys.");
    expect(summarize("- [Docs](/docs) cover it.\n\nMore text.")).toBe(
      "Docs cover it.",
    );
    expect(
      summarize(
        "<Callout>JSX line skipped</Callout>\n\nBody on the next line.",
      ),
    ).toBe("Body on the next line.");
    expect(summarize("")).toBe("");
  });

  test("truncates long summaries, preferring a word boundary", () => {
    const summary = summarize(`${"word ".repeat(60)}end`);
    expect(summary.length).toBeLessThanOrEqual(201);
    expect(summary.endsWith("…")).toBe(true);
    expect(summary).not.toContain("wor…");
  });
});

describe("entries", () => {
  test("sorts newest first, same day by slug, without mutating the collection", () => {
    expect(getEntries().map((entry) => entry.slug)).toEqual([
      "dark-mode",
      "faster-checkout",
      "twin",
      "annual-invoice-fix",
    ]);
  });

  test("groups by month: months newest first, newest first within each group", () => {
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

  test("paths and anchors", () => {
    expect(changelogPath).toBe("/changelog");
    expect(feedPath).toBe("/changelog/rss.xml");
    // The changelog is a single page; each entry gets its own address only via its anchor (the RSS guid uses it).
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

  test("RSS 2.0: channel and item have every required field", () => {
    const xml = feed();
    // The snapshot only locks structure and paths: the domain is replaced with a placeholder so buyers
    // don't have to rerun `-u` after changing `domain` (same as blog.test.ts).
    expect(withoutSiteDomain(xml)).toMatchSnapshot();

    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<rss version="2.0"');
    // channel: title / link / description are the three fields RSS 2.0 requires; language and the
    // self link come along.
    expect(xml).toContain("<title>Acme Changelog</title>");
    expect(xml).toContain(`<link>${origin}/changelog</link>`);
    expect(xml).toContain(
      "<description>New features &amp; fixes</description>",
    );
    expect(xml).toContain("<language>en</language>");
    expect(xml).toContain(
      `<atom:link href="${origin}/changelog/rss.xml" rel="self" type="application/rss+xml" />`,
    );
    // Each item has at least title / link / guid / pubDate / description (RSS requires title or
    // description).
    const first = xml.slice(xml.indexOf("<item>"), xml.indexOf("</item>"));
    for (const tag of ["title", "link", "guid", "pubDate", "description"]) {
      expect(first).toContain(`<${tag}`);
    }
  });

  test("item link and guid are page anchors and are unique", () => {
    const xml = feed();
    expect(xml).toContain(`<link>${origin}/changelog#dark-mode</link>`);
    expect(xml).toContain(
      `<guid isPermaLink="true">${origin}/changelog#dark-mode</guid>`,
    );
    expect(xml).toContain("<pubDate>Thu, 24 Sep 2026 00:00:00 GMT</pubDate>");
    // Categories are emitted as <category>.
    expect(xml).toContain("<category>improvement</category>");
    expect(xml).toContain("<category>fix</category>");

    const guids = [...xml.matchAll(/<guid[^>]*>([^<]+)<\/guid>/g)].map(
      (match) => match[1],
    );
    expect(guids).toHaveLength(4);
    expect(new Set(guids).size).toBe(4);
  });

  test("escapes XML characters in titles", () => {
    expect(feed()).toContain("<title>Dark mode &lt;everywhere&gt;</title>");
    expect(feed()).toContain(
      "<description>About dark-mode &amp; more</description>",
    );
  });

  test("links for other locales carry the locale prefix", () => {
    const xml = feed("de");
    expect(xml).toContain(`<link>${origin}/de/changelog</link>`);
    expect(xml).toContain(`<link>${origin}/de/changelog#twin</link>`);
    expect(xml).toContain("<language>de</language>");
  });
});

describe("sitemap", () => {
  test("when changelog is on, /changelog is in the sitemap with hreflang", () => {
    // The full sitemap snapshot is in src/core/seo/seo.test.ts; this only checks the changelog entry.
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
  test("footer shows the changelog link when the flag is on", () => {
    const product = footerNav(siteConfig).find(
      (group) => group.key === "product",
    );
    expect(product?.links.map((link) => link.href)).toContain(changelogPath);
  });

  test("the link disappears when the flag is off; other groups and links are unchanged", () => {
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
    // Every other link in the same group is still there.
    expect(
      groups.find((group) => group.key === "product")?.links.map((l) => l.href),
    ).toEqual(["/#features", "/pricing", "/#faq", "/blog"]);
  });
});
