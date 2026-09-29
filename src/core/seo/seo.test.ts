import { describe, expect, test, vi } from "vitest";

import robots from "@/app/robots";
import sitemap from "@/app/sitemap";

import siteConfig from "../../../site.config";
import { withoutSiteDomain } from "../config/testing";
import { serializeJsonLd } from "./json-ld";
import { buildMetadata } from "./metadata";
import { languageAlternates, localizedPath } from "./urls";

// Simulates a multilingual site to cover prefixed locales.
vi.mock("@/core/i18n/routing", () => ({
  routing: { locales: ["en", "de"], defaultLocale: "en" },
}));

// Blog entries are tested with fixed data in src/core/blog/blog.test.ts, so example posts don't
// affect this file.
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

  test("for a page in only some locales, x-default prefers the default locale", () => {
    expect(languageAlternates("/blog/a", ["de"])).toEqual({
      de: `${origin}/de/blog/a`,
      "x-default": `${origin}/de/blog/a`,
    });
    expect(languageAlternates("/blog/a", [])).toEqual({});
  });

  test("hreflang includes every locale and x-default", () => {
    expect(languageAlternates("/privacy")).toEqual({
      en: `${origin}/privacy`,
      de: `${origin}/de/privacy`,
      "x-default": `${origin}/privacy`,
    });
  });
});

describe("buildMetadata", () => {
  test("home page uses the site name and title template", () => {
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

  test("og:locale is emitted as language_TERRITORY; unlisted locales are emitted as-is", () => {
    expect(buildMetadata({ locale: "en", path: "/" }).openGraph).toMatchObject({
      locale: "en_US",
    });
    expect(buildMetadata({ locale: "zh", path: "/" }).openGraph).toMatchObject({
      locale: "zh_CN",
    });
    expect(buildMetadata({ locale: "de", path: "/" }).openGraph).toMatchObject({
      locale: "de",
    });
  });

  test("subpages use the template and can override description and share image", () => {
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

  test("noIndex disables indexing", () => {
    const metadata = buildMetadata({ locale: "en", path: "/x", noIndex: true });
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  test("with path null, emits no canonical / hreflang / og:url (404)", () => {
    const metadata = buildMetadata({
      locale: "en",
      path: null,
      title: "Page not found",
      description: "The page you are looking for doesn't exist.",
    });
    // An empty object rather than omission — Next shallow-merges metadata per field, so omitting it
    // would let the layout's canonical pointing at the home page be inherited by the 404. That has
    // happened before; only the empty object prevents it.
    expect(Object.keys(metadata.alternates ?? {})).toEqual([]);
    expect(metadata.openGraph).toMatchObject({
      title: `Page not found | ${siteConfig.name}`,
      description: "The page you are looking for doesn't exist.",
      siteName: siteConfig.name,
    });
    expect(metadata.openGraph).not.toHaveProperty("url");
  });
});

describe("sitemap", () => {
  test("marketing routes × locales, with hreflang", () => {
    expect(withoutSiteDomain(sitemap())).toMatchSnapshot();
  });
});

describe("robots", () => {
  test("blocks only the machine endpoint /api and points to the sitemap", () => {
    expect(withoutSiteDomain(robots())).toMatchSnapshot();
  });

  test("dashboard / admin are not in Disallow; indexing is left to each page's noIndex", () => {
    // Crawlers can't fetch a Disallowed path, so they never see the page's meta noindex, and with
    // external links it may actually show up in results as a bare URL — stacking both blocks makes
    // them cancel out. The page half (noIndex) is in src/app/[locale]/(app)/dashboard/page.tsx and
    // src/core/admin/metadata.ts.
    const { rules } = robots();
    const disallow = (Array.isArray(rules) ? rules[0] : rules)?.disallow;
    expect(disallow).toEqual(["/api"]);
  });
});

describe("serializeJsonLd", () => {
  test("escapes characters that could close a script tag", () => {
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
