import { expect, test } from "@playwright/test";

import siteConfig from "../../site.config";
import { TEST_LOCALE } from "./test-locale";

const origin = `https://${siteConfig.domain}`;

// The test locale has no content/blog/<locale>/ directory: the index is empty and not indexed, and
// English posts don't show up under this locale.
test("locale without posts: empty index, noindex, posts 404", async ({
  page,
  request,
}) => {
  const response = await page.goto(`/${TEST_LOCALE}/blog`);
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { level: 1, name: `[${TEST_LOCALE}] Blog` }),
  ).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex, nofollow",
  );

  expect((await page.goto(`/${TEST_LOCALE}/blog/hello-world`))?.status()).toBe(
    404,
  );

  const rss = await request.get(`/${TEST_LOCALE}/blog/rss.xml`);
  expect(rss.status()).toBe(200);
  expect(await rss.text()).toContain(
    `<link>${origin}/${TEST_LOCALE}/blog</link>`,
  );

  const map = await (await request.get("/sitemap.xml")).text();
  expect(map).not.toContain(`${origin}/${TEST_LOCALE}/blog`);
});
