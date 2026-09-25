import { expect, test } from "@playwright/test";

import siteConfig from "../../site.config";
import { TEST_LOCALE } from "./test-locale";

const origin = `https://${siteConfig.domain}`;
const localized = `${origin}/${TEST_LOCALE}`;

test("非默认语言页面的 canonical 与 hreflang", async ({ page }) => {
  await page.goto(`/${TEST_LOCALE}`);
  const head = page.locator("head");

  await expect(head.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    localized,
  );
  const alternates = head.locator('link[rel="alternate"][hreflang]');
  await expect(alternates).toHaveCount(3);
  await expect(
    head.locator(`link[rel="alternate"][hreflang="${TEST_LOCALE}"]`),
  ).toHaveAttribute("href", localized);
  await expect(
    head.locator('link[rel="alternate"][hreflang="en"]'),
  ).toHaveAttribute("href", origin);
  await expect(head.locator('meta[property="og:locale"]')).toHaveAttribute(
    "content",
    TEST_LOCALE,
  );
  await expect(head.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    /^\[de\] /,
  );
});

test("sitemap 为每个语言列出一条并带 alternates", async ({ request }) => {
  const xml = await (await request.get("/sitemap.xml")).text();
  expect(xml).toContain(`<loc>${origin}</loc>`);
  expect(xml).toContain(`<loc>${localized}</loc>`);
  expect(xml).toContain(
    `<xhtml:link rel="alternate" hreflang="${TEST_LOCALE}" href="${localized}" />`,
  );
});

test("robots.txt 同时禁止带语言前缀的私有路径", async ({ request }) => {
  const text = await (await request.get("/robots.txt")).text();
  expect(text).toContain(`Disallow: /${TEST_LOCALE}/dashboard\n`);
});
