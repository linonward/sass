import { expect, test } from "@playwright/test";

import messages from "../messages/en.json";
import siteConfig from "../site.config";

// Sample posts that ship with the repo (content/blog/en/).
const post = { slug: "hello-world", title: "Hello, world", tag: "guides" };
const draft = "draft-example";
const origin = `https://${siteConfig.domain}`;

test("index lists posts; clicking opens the post page", async ({ page }) => {
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

test("post page has canonical, a post OG image, and BlogPosting JSON-LD", async ({
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

test("tag page lists posts with that tag; unknown tags 404", async ({
  page,
}) => {
  await page.goto(`/blog/${post.slug}`);
  await page
    .getByRole("link", { name: `#${post.tag}` })
    .first()
    .click();
  await expect(page).toHaveURL(`/blog/tags/${post.tag}`);
  await expect(page.getByRole("link", { name: post.title })).toBeVisible();

  // Tag pages are in the sitemap, so they must really be indexable: self-referencing canonical,
  // no meta robots.
  await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute(
    "href",
    `${origin}/blog/tags/${post.tag}`,
  );
  await expect(page.locator('head meta[name="robots"]')).toHaveCount(0);

  const response = await page.goto("/blog/tags/no-such-tag");
  expect(response?.status()).toBe(404);
});

test("RSS and sitemap include posts", async ({ request }) => {
  const rss = await request.get("/blog/rss.xml");
  expect(rss.status()).toBe(200);
  expect(rss.headers()["content-type"]).toContain("application/rss+xml");
  const xml = await rss.text();
  expect(xml).toContain(`<link>${origin}/blog/${post.slug}</link>`);
  expect(xml).not.toContain(draft);

  const map = await (await request.get("/sitemap.xml")).text();
  expect(map).toContain(`<loc>${origin}/blog</loc>`);
  expect(map).toContain(`<loc>${origin}/blog/${post.slug}</loc>`);
  // Tag pages (and /blog/page/<n>, /blog/tags/<tag>/page/<n> when there's a second page) are
  // included too.
  expect(map).toContain(`<loc>${origin}/blog/tags/${post.tag}</loc>`);
  expect(map).not.toContain(draft);
});

test("every blog URL in the sitemap opens", async ({ request }) => {
  // Listed ⇔ has a page: no sitemap entry may 404 (index, tag pages, and pagination all count).
  const map = await (await request.get("/sitemap.xml")).text();
  const urls = [...map.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((match) => match[1]!)
    .filter((url) => url.includes("/blog"));
  expect(urls.length).toBeGreaterThan(0);

  for (const url of urls) {
    // <loc> is an absolute URL on the site's domain; turn it into a path relative to the local
    // server.
    const response = await request.get(new URL(url).pathname);
    expect(response.status(), url).toBe(200);
  }
});

test("drafts return 404 in production builds", async ({ page, request }) => {
  // Local e2e runs the dev server, where drafts are visible; CI runs a production build.
  test.skip(!process.env.CI, "drafts are only hidden in production builds");
  const response = await page.goto(`/blog/${draft}`);
  expect(response?.status()).toBe(404);
  expect((await request.get(`/blog/${draft}/og`)).status()).toBe(404);
});

test.describe("375px width", () => {
  test.use({ viewport: { width: 375, height: 740 } });

  test("index and post pages don't overflow horizontally", async ({ page }) => {
    for (const path of ["/blog", `/blog/${post.slug}`]) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
});
