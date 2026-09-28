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
  await expect(alternates).toHaveCount(4); // en, zh, de, x-default
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

test("带语言前缀的私有路径不进 robots，排除交给页面 noindex", async ({
  request,
}) => {
  const text = await (await request.get("/robots.txt")).text();
  // robots 只留没有 HTML 的机器端点：Disallow 挡住的页面爬虫读不到 meta noindex，
  // 反而可能以裸 URL 进结果。所以这里连语言前缀的变体都不该出现。
  expect(text).toContain("Disallow: /api\n");
  expect(text).not.toContain("/dashboard");

  // 私有路径本身仍不可收录：未登录时 307 到**同一语言**的登录页（noindex）。
  const response = await request.get(`/${TEST_LOCALE}/dashboard`, {
    maxRedirects: 0,
  });
  expect(response.status()).toBe(307);
  expect(response.headers()["location"]).toContain(`/${TEST_LOCALE}/sign-in`);
});
