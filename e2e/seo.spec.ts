import { expect, test } from "@playwright/test";

import messages from "../messages/en.json";
import siteConfig from "../site.config";

const origin = `https://${siteConfig.domain}`;

test("home page has canonical, hreflang, Open Graph, and JSON-LD", async ({
  page,
}) => {
  await page.goto("/");
  const head = page.locator("head");

  // The home page title must say what the page is about, not just the site name; the description
  // follows the Hero.
  await expect(page).toHaveTitle(
    `${messages.Metadata.homeTitle} | ${siteConfig.name}`,
  );
  await expect(head.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    messages.Metadata.description,
  );
  await expect(head.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    origin,
  );
  await expect(
    head.locator('link[rel="alternate"][hreflang="en"]'),
  ).toHaveAttribute("href", origin);
  await expect(
    head.locator('link[rel="alternate"][hreflang="x-default"]'),
  ).toHaveAttribute("href", origin);
  await expect(head.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    `${origin}/opengraph-image`,
  );
  await expect(head.locator('meta[property="og:locale"]')).toHaveAttribute(
    "content",
    "en_US",
  );
  await expect(head.locator('meta[name="twitter:card"]')).toHaveAttribute(
    "content",
    "summary_large_image",
  );

  const jsonLd = await page
    .locator('script[type="application/ld+json"]')
    .textContent();
  expect(JSON.parse(jsonLd!)).toEqual([
    expect.objectContaining({ "@type": "Organization", name: siteConfig.name }),
    expect.objectContaining({ "@type": "WebSite", url: origin }),
  ]);
});

test("OG image is reachable", async ({ request }) => {
  const response = await request.get("/opengraph-image");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/png");
});

test("tab icon (favicon) has a link and the image loads", async ({
  page,
  request,
}) => {
  await page.goto("/");
  // Only pin "there's an icon, and it loads": the href depends on the implementation (the built-in
  // generated one is /icon; once a buyer swaps in their own icon.svg / icon.png per the README, it
  // becomes that file), so read it from the DOM.
  const href = await page
    .locator('head link[rel="icon"]')
    .first()
    .getAttribute("href");
  expect(href).toBeTruthy();

  // If it doesn't load, the browser tab is blank — it only counts if it's not a 404 and the response
  // really is an image.
  const response = await request.get(href!);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^image\//);
});

test("sitemap.xml lists the home page", async ({ request }) => {
  const response = await request.get("/sitemap.xml");
  expect(response.status()).toBe(200);
  const xml = await response.text();
  expect(xml).toContain(`<loc>${origin}</loc>`);
  expect(xml).toContain(
    `<xhtml:link rel="alternate" hreflang="x-default" href="${origin}" />`,
  );
});

test("robots.txt only blocks the machine endpoint /api and points to the sitemap", async ({
  request,
}) => {
  const response = await request.get("/robots.txt");
  expect(response.status()).toBe(200);
  const text = await response.text();
  expect(text).toContain("Disallow: /api\n");
  expect(text).toContain(`Sitemap: ${origin}/sitemap.xml`);
});

test("dashboard / admin stay out of robots and are excluded by their own noindex", async ({
  page,
  request,
}) => {
  // Stacking both kinds of blocking cancels them out: crawlers can't fetch a path blocked by
  // Disallow, so they never read the page's meta noindex, and with inbound links it may even show
  // up in results as a bare URL. Keep noindex (on the page side, in dashboard/page.tsx and
  // admin/metadata.ts), and leave robots with only endpoints like /api that have no HTML.
  const text = await (await request.get("/robots.txt")).text();
  for (const path of ["/dashboard", "/admin"]) {
    expect(text).not.toContain(`Disallow: ${path}\n`);
  }

  // A crawler fetching /dashboard gets a 307 + a sign-in page that's also noindex, so nothing is
  // indexable.
  const response = await page.goto("/dashboard");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.locator('head meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex, nofollow",
  );
});

test("llms.txt is a site index for agents", async ({ request }) => {
  const response = await request.get("/llms.txt");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/plain");

  const text = await response.text();
  // Site name and one-line tagline come from config.
  expect(
    text.startsWith(`# ${siteConfig.name}\n\n> ${siteConfig.description}\n`),
  ).toBe(true);
  // Public pages, plus machine-readable resources.
  expect(text).toContain(`- [Home](${origin}):`);
  expect(text).toContain(`- [${messages.Nav.pricing}](${origin}/pricing):`);
  expect(text).toContain(`(${origin}/sitemap.xml)`);
  expect(text).toContain(`(${origin}/robots.txt)`);
  // Plan names come from messages and prices from config; changing either updates this.
  const pro = siteConfig.billing.plans.find((plan) => plan.id === "pro")!;
  const proLine = text
    .split("\n")
    .find((line) =>
      line.startsWith(`- [${messages.Landing.pricing.plans.pro.name} `),
    )!;
  expect(proLine).toContain(String(pro.price));
  // Paths that require sign-in are listed as plain text, not links — fetching them only yields
  // the sign-in page.
  expect(text).toContain("\n- /dashboard\n");
  expect(text).toContain("\n- /admin\n");
  expect(text).not.toContain("- [/dashboard]");
});
