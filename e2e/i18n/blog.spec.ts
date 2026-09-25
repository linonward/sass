import { expect, test } from "@playwright/test";

import siteConfig from "../../site.config";
import { TEST_LOCALE } from "./test-locale";

const origin = `https://${siteConfig.domain}`;

// 测试语言没有 content/blog/<locale>/ 目录：列表页为空且不收录，英文文章不会出现在这个语言下。
test("没有文章的语言：空列表、noindex、文章 404", async ({ page, request }) => {
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
