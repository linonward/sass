import { expect, test } from "@playwright/test";

import messages from "../messages/en.json";
import siteConfig from "../site.config";

// Sample entries that ship with the repo (content/changelog/).
const newest = {
  slug: "dark-mode",
  title: "Dark mode everywhere",
  category: messages.Changelog.categories.feature,
  month: "September 2026",
};
const origin = `https://${siteConfig.domain}`;

test("footer leads to the changelog; entries are grouped by month with category badges", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: messages.Nav.product })
    .getByRole("link", { name: messages.Nav.changelog })
    .click();
  await expect(page).toHaveURL("/changelog");
  await expect(
    page.getByRole("heading", { level: 1, name: messages.Changelog.title }),
  ).toBeVisible();

  // At least one entry, newest first (grouped by month: September's group comes before August's).
  const entries = page.getByRole("article");
  await expect(entries.first()).toHaveAttribute("id", newest.slug);
  // Scope month headings to <main>: the footer's group headings are also h2 (Product / Legal) and
  // would be counted otherwise.
  const main = page.getByRole("main");
  await expect(
    main.getByRole("heading", { level: 2, name: newest.month }),
  ).toBeVisible();
  await expect(
    main.getByRole("heading", { level: 3, name: newest.title }),
  ).toBeVisible();
  // Group order: the first month heading is September, with August after it.
  const months = await main
    .getByRole("heading", { level: 2 })
    .allTextContents();
  expect(months).toEqual(["September 2026", "August 2026"]);

  // One badge per category (the sample entries cover feature / improvement / fix).
  for (const category of Object.values(messages.Changelog.categories)) {
    await expect(
      page.getByText(category, { exact: true }).first(),
    ).toBeVisible();
  }

  // The RSS link is on the page and in the head (readers discover the feed via the link tag).
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

test("RSS is valid RSS 2.0 and the sitemap includes the changelog", async ({
  request,
}) => {
  const rss = await request.get("/changelog/rss.xml");
  expect(rss.status()).toBe(200);
  expect(rss.headers()["content-type"]).toContain("application/rss+xml");
  const xml = await rss.text();

  // The three required channel fields + required item fields; entry URLs are anchors on the page.
  expect(xml).toContain("<title>");
  expect(xml).toContain(`<link>${origin}/changelog</link>`);
  expect(xml).toContain(`<link>${origin}/changelog#${newest.slug}</link>`);
  expect(xml).toContain(`<guid isPermaLink="true">${origin}/changelog#`);
  expect(xml).toContain("<pubDate>");
  expect(xml).toContain("<category>feature</category>");

  const map = await (await request.get("/sitemap.xml")).text();
  expect(map).toContain(`<loc>${origin}/changelog</loc>`);
});

test.describe("375px width", () => {
  test.use({ viewport: { width: 375, height: 740 } });

  for (const theme of ["light", "dark"] as const) {
    test(`${theme} mode doesn't overflow horizontally`, async ({ page }) => {
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
