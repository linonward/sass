import { expect, test } from "@playwright/test";

import messages from "../messages/en.json";
import siteConfig from "../site.config";

// 仓库自带的示例条目（content/changelog/）。
const newest = {
  slug: "dark-mode",
  title: "Dark mode everywhere",
  category: messages.Changelog.categories.feature,
  month: "September 2026",
};
const origin = `https://${siteConfig.domain}`;

test("页脚进入 changelog，条目按月份分组、带类别徽章", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: messages.Nav.product })
    .getByRole("link", { name: messages.Nav.changelog })
    .click();
  await expect(page).toHaveURL("/changelog");
  await expect(
    page.getByRole("heading", { level: 1, name: messages.Changelog.title }),
  ).toBeVisible();

  // 至少一条条目，最新的那条在最前面（按月分组：9 月的组在 8 月之前）。
  const entries = page.getByRole("article");
  await expect(entries.first()).toHaveAttribute("id", newest.slug);
  // 月份标题限定在 <main> 里：页脚的分组标题也是 h2（Product / Legal），不限定会把它们一起数进来。
  const main = page.getByRole("main");
  await expect(
    main.getByRole("heading", { level: 2, name: newest.month }),
  ).toBeVisible();
  await expect(
    main.getByRole("heading", { level: 3, name: newest.title }),
  ).toBeVisible();
  // 分组顺序：第一个月份标题是 9 月，8 月排在后面。
  const months = await main
    .getByRole("heading", { level: 2 })
    .allTextContents();
  expect(months).toEqual(["September 2026", "August 2026"]);

  // 三个类别各有一个徽章（示例条目覆盖了 feature / improvement / fix）。
  for (const category of Object.values(messages.Changelog.categories)) {
    await expect(
      page.getByText(category, { exact: true }).first(),
    ).toBeVisible();
  }

  // RSS 入口在页面上，也在 head 里（阅读器靠 link 标签发现 feed）。
  await expect(
    page.getByRole("link", { name: messages.Changelog.rss }),
  ).toHaveAttribute("href", "/changelog/rss.xml");
  await expect(
    page.locator('link[type="application/rss+xml"]'),
  ).toHaveAttribute("href", `${origin}/changelog/rss.xml`);
  await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute(
    "href",
    `${origin}/changelog`,
  );
});

test("RSS 是合法 RSS 2.0，sitemap 收录 changelog", async ({ request }) => {
  const rss = await request.get("/changelog/rss.xml");
  expect(rss.status()).toBe(200);
  expect(rss.headers()["content-type"]).toContain("application/rss+xml");
  const xml = await rss.text();

  // channel 的必填三项 + item 的必填字段；条目地址是页面上的锚点。
  expect(xml).toContain("<title>");
  expect(xml).toContain(`<link>${origin}/changelog</link>`);
  expect(xml).toContain(`<link>${origin}/changelog#${newest.slug}</link>`);
  expect(xml).toContain(`<guid isPermaLink="true">${origin}/changelog#`);
  expect(xml).toContain("<pubDate>");
  expect(xml).toContain("<category>feature</category>");

  const map = await (await request.get("/sitemap.xml")).text();
  expect(map).toContain(`<loc>${origin}/changelog</loc>`);
});

test.describe("375px 宽度", () => {
  test.use({ viewport: { width: 375, height: 740 } });

  for (const theme of ["light", "dark"] as const) {
    test(`${theme} 模式下不横向溢出`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto("/changelog");
      await expect(
        page.getByRole("heading", { level: 1, name: messages.Changelog.title }),
      ).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
