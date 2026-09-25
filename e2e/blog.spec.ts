import { expect, test } from "@playwright/test";

import messages from "../messages/en.json";
import siteConfig from "../site.config";

// 仓库自带的示例文章（content/blog/en/）。
const post = { slug: "hello-world", title: "Hello, world", tag: "guides" };
const draft = "draft-example";
const origin = `https://${siteConfig.domain}`;

test("列表页列出文章，点击进入文章页", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: messages.Nav.product })
    .getByRole("link", { name: messages.Nav.blog })
    .click();
  await expect(page).toHaveURL("/blog");
  await expect(
    page.getByRole("heading", { level: 1, name: messages.Blog.title }),
  ).toBeVisible();
  await expect(
    page.locator('link[type="application/rss+xml"]'),
  ).toHaveAttribute("href", `${origin}/blog/rss.xml`);

  await page.getByRole("link", { name: post.title }).click();
  await expect(page).toHaveURL(`/blog/${post.slug}`);
  await expect(
    page.getByRole("heading", { level: 1, name: post.title }),
  ).toBeVisible();
  await expect(page.getByRole("article")).toContainText("Writing a post");
});

test("文章页有 canonical、文章 OG 图和 BlogPosting JSON-LD", async ({
  page,
  request,
}) => {
  await page.goto(`/blog/${post.slug}`);
  const url = `${origin}/blog/${post.slug}`;
  const head = page.locator("head");
  await expect(head.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    url,
  );
  await expect(head.locator('meta[property="og:type"]')).toHaveAttribute(
    "content",
    "article",
  );
  await expect(head.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    `${url}/og`,
  );

  const jsonLd = await page
    .locator('script[type="application/ld+json"]')
    .allTextContents();
  expect(jsonLd.map((text) => JSON.parse(text))).toContainEqual(
    expect.objectContaining({
      "@type": "BlogPosting",
      headline: post.title,
      url,
    }),
  );

  const og = await request.get(`/blog/${post.slug}/og`);
  expect(og.status()).toBe(200);
  expect(og.headers()["content-type"]).toBe("image/png");
});

test("标签页列出带该标签的文章，未知标签 404", async ({ page }) => {
  await page.goto(`/blog/${post.slug}`);
  await page
    .getByRole("link", { name: `#${post.tag}` })
    .first()
    .click();
  await expect(page).toHaveURL(`/blog/tags/${post.tag}`);
  await expect(page.getByRole("link", { name: post.title })).toBeVisible();

  const response = await page.goto("/blog/tags/no-such-tag");
  expect(response?.status()).toBe(404);
});

test("RSS 和 sitemap 包含文章", async ({ request }) => {
  const rss = await request.get("/blog/rss.xml");
  expect(rss.status()).toBe(200);
  expect(rss.headers()["content-type"]).toContain("application/rss+xml");
  const xml = await rss.text();
  expect(xml).toContain(`<link>${origin}/blog/${post.slug}</link>`);
  expect(xml).not.toContain(draft);

  const map = await (await request.get("/sitemap.xml")).text();
  expect(map).toContain(`<loc>${origin}/blog</loc>`);
  expect(map).toContain(`<loc>${origin}/blog/${post.slug}</loc>`);
  expect(map).not.toContain(draft);
});

test("生产构建里草稿返回 404", async ({ page, request }) => {
  // 本地 e2e 跑的是 dev server，草稿可见；CI 跑生产构建。
  test.skip(!process.env.CI, "草稿只在生产构建里隐藏");
  const response = await page.goto(`/blog/${draft}`);
  expect(response?.status()).toBe(404);
  expect((await request.get(`/blog/${draft}/og`)).status()).toBe(404);
});

test.describe("375px 宽度", () => {
  test.use({ viewport: { width: 375, height: 740 } });

  test("列表页和文章页不横向溢出", async ({ page }) => {
    for (const path of ["/blog", `/blog/${post.slug}`]) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
});
