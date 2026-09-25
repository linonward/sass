import { expect, test } from "@playwright/test";

import messages from "../messages/en.json";
import siteConfig from "../site.config";
import { legalPages } from "../src/core/legal/pages";

const pages = Object.entries(legalPages) as [keyof typeof legalPages, string][];

test("三个法律页返回 200，包含配置中的公司名，title 各不相同", async ({
  page,
}) => {
  const titles = new Set<string>();
  for (const [key, path] of pages) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: messages.Nav[key] }),
    ).toBeVisible();
    await expect(page.getByRole("article")).toContainText(
      siteConfig.legal.companyName,
    );
    await expect(
      page.getByRole("link", { name: siteConfig.legal.contactEmail }).first(),
    ).toHaveAttribute("href", `mailto:${siteConfig.legal.contactEmail}`);
    const description = page.locator('meta[name="description"]');
    await expect(description).toHaveAttribute("content", /.+/);
    titles.add(await page.title());
  }
  expect(titles.size).toBe(pages.length);
});

test("Footer 的法律链接可以跳转", async ({ page }) => {
  await page.goto("/");
  const footer = page.getByRole("navigation", { name: messages.Nav.legal });
  for (const [key, path] of pages) {
    await footer.getByRole("link", { name: messages.Nav[key] }).click();
    await expect(page).toHaveURL(path);
    await expect(
      page.getByRole("heading", { level: 1, name: messages.Nav[key] }),
    ).toBeVisible();
  }
});

test.describe("375px 宽度", () => {
  test.use({ viewport: { width: 375, height: 740 } });

  test("法律页不横向溢出", async ({ page }) => {
    for (const [, path] of pages) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
});

test("法律页使用统一的 SEO metadata", async ({ page }) => {
  await page.goto(legalPages.privacy);
  await expect(page).toHaveTitle(new RegExp(`\\| ${siteConfig.name}$`));
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    `https://${siteConfig.domain}${legalPages.privacy}`,
  );
});
