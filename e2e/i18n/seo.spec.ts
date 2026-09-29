import { expect, test } from "@playwright/test";

import siteConfig from "../../site.config";
import { TEST_LOCALE } from "./test-locale";

const origin = `https://${siteConfig.domain}`;
const localized = `${origin}/${TEST_LOCALE}`;

test("canonical and hreflang on non-default-locale pages", async ({ page }) => {
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

test("sitemap lists one entry per locale with alternates", async ({
  request,
}) => {
  const xml = await (await request.get("/sitemap.xml")).text();
  expect(xml).toContain(`<loc>${origin}</loc>`);
  expect(xml).toContain(`<loc>${localized}</loc>`);
  expect(xml).toContain(
    `<xhtml:link rel="alternate" hreflang="${TEST_LOCALE}" href="${localized}" />`,
  );
});

test("locale-prefixed private paths stay out of robots; exclusion is left to page noindex", async ({
  request,
}) => {
  const text = await (await request.get("/robots.txt")).text();
  // robots only lists machine endpoints with no HTML: crawlers can't read meta noindex on a page
  // blocked by Disallow, so it may end up in results as a bare URL. That's why not even the
  // locale-prefixed variants should appear here.
  expect(text).toContain("Disallow: /api\n");
  expect(text).not.toContain("/dashboard");

  // The private paths themselves still can't be indexed: signed out, they 307 to the sign-in page
  // in the **same locale** (noindex).
  const response = await request.get(`/${TEST_LOCALE}/dashboard`, {
    maxRedirects: 0,
  });
  expect(response.status()).toBe(307);
  expect(response.headers()["location"]).toContain(`/${TEST_LOCALE}/sign-in`);
});
