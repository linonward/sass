import { expect, test } from "@playwright/test";

import siteConfig from "../site.config";

const origin = `https://${siteConfig.domain}`;

test("首页包含 canonical、hreflang、Open Graph 与 JSON-LD", async ({
  page,
}) => {
  await page.goto("/");
  const head = page.locator("head");

  await expect(page).toHaveTitle(siteConfig.name);
  await expect(head.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    origin,
  );
  await expect(
    head.locator('link[rel="alternate"][hreflang="en"]'),
  ).toHaveAttribute("href", origin);
  await expect(
    head.locator('link[rel="alternate"][hreflang="x-default"]'),
  ).toHaveAttribute("href", origin);
  await expect(head.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    `${origin}/opengraph-image`,
  );
  await expect(head.locator('meta[name="twitter:card"]')).toHaveAttribute(
    "content",
    "summary_large_image",
  );

  const jsonLd = await page
    .locator('script[type="application/ld+json"]')
    .textContent();
  expect(JSON.parse(jsonLd!)).toEqual([
    expect.objectContaining({ "@type": "Organization", name: siteConfig.name }),
    expect.objectContaining({ "@type": "WebSite", url: origin }),
  ]);
});

test("OG 图可以访问", async ({ request }) => {
  const response = await request.get("/opengraph-image");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/png");
});

test("sitemap.xml 列出首页", async ({ request }) => {
  const response = await request.get("/sitemap.xml");
  expect(response.status()).toBe(200);
  const xml = await response.text();
  expect(xml).toContain(`<loc>${origin}</loc>`);
  expect(xml).toContain(
    `<xhtml:link rel="alternate" hreflang="x-default" href="${origin}" />`,
  );
});

test("robots.txt 禁止抓取私有路径并指向 sitemap", async ({ request }) => {
  const response = await request.get("/robots.txt");
  expect(response.status()).toBe(200);
  const text = await response.text();
  for (const path of ["/api", "/dashboard", "/admin"]) {
    expect(text).toContain(`Disallow: ${path}\n`);
  }
  expect(text).toContain(`Sitemap: ${origin}/sitemap.xml`);
});
