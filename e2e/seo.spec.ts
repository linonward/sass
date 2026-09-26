import { expect, test } from "@playwright/test";

import messages from "../messages/en.json";
import siteConfig from "../site.config";

const origin = `https://${siteConfig.domain}`;

test("首页包含 canonical、hreflang、Open Graph 与 JSON-LD", async ({
  page,
}) => {
  await page.goto("/");
  const head = page.locator("head");

  await expect(page).toHaveTitle(siteConfig.name);
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

test("OG 图可以访问", async ({ request }) => {
  const response = await request.get("/opengraph-image");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/png");
});

test("sitemap.xml 列出首页", async ({ request }) => {
  const response = await request.get("/sitemap.xml");
  expect(response.status()).toBe(200);
  const xml = await response.text();
  expect(xml).toContain(`<loc>${origin}</loc>`);
  expect(xml).toContain(
    `<xhtml:link rel="alternate" hreflang="x-default" href="${origin}" />`,
  );
});

test("robots.txt 禁止抓取私有路径并指向 sitemap", async ({ request }) => {
  const response = await request.get("/robots.txt");
  expect(response.status()).toBe(200);
  const text = await response.text();
  for (const path of ["/api", "/dashboard", "/admin"]) {
    expect(text).toContain(`Disallow: ${path}\n`);
  }
  expect(text).toContain(`Sitemap: ${origin}/sitemap.xml`);
});

test("llms.txt 是给 agent 的站点索引", async ({ request }) => {
  const response = await request.get("/llms.txt");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/plain");

  const text = await response.text();
  // 站点名和一句话简介取自配置。
  expect(
    text.startsWith(`# ${siteConfig.name}\n\n> ${siteConfig.description}\n`),
  ).toBe(true);
  // 公开页面，以及机器可读资源。
  expect(text).toContain(`- [Home](${origin}):`);
  expect(text).toContain(`- [${messages.Nav.pricing}](${origin}/pricing):`);
  expect(text).toContain(`(${origin}/sitemap.xml)`);
  expect(text).toContain(`(${origin}/robots.txt)`);
  // 套餐名称来自文案、价格来自配置，改任一边这里都跟着变。
  const pro = siteConfig.billing.plans.find((plan) => plan.id === "pro")!;
  const proLine = text
    .split("\n")
    .find((line) =>
      line.startsWith(`- [${messages.Landing.pricing.plans.pro.name} `),
    )!;
  expect(proLine).toContain(String(pro.price));
  // 需要登录的路径列成纯文字，不做成链接 —— 抓过去只有登录页。
  expect(text).toContain("\n- /dashboard\n");
  expect(text).toContain("\n- /admin\n");
  expect(text).not.toContain("- [/dashboard]");
});
