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

test("标签页图标（favicon）有 link 且能取到图片", async ({ page, request }) => {
  await page.goto("/");
  // 只锁「有图标、且图标取得到」：href 由实现决定（内置生成的是 /icon，
  // 买家按 README 换成自己的 icon.svg / icon.png 后就变成那个文件），所以从 DOM 里读。
  const href = await page
    .locator('head link[rel="icon"]')
    .first()
    .getAttribute("href");
  expect(href).toBeTruthy();

  // 取不到时浏览器标签页就是空白 —— 不是 404、且响应确实是张图才算数。
  const response = await request.get(href!);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^image\//);
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

test("robots.txt 只挡机器端点 /api 并指向 sitemap", async ({ request }) => {
  const response = await request.get("/robots.txt");
  expect(response.status()).toBe(200);
  const text = await response.text();
  expect(text).toContain("Disallow: /api\n");
  expect(text).toContain(`Sitemap: ${origin}/sitemap.xml`);
});

test("dashboard / admin 不进 robots，靠页面自己的 noindex 排除", async ({
  page,
  request,
}) => {
  // 两套封锁叠在一起是互相抵消：Disallow 挡住的路径爬虫抓不到，也就读不到页面上的
  // meta noindex，有外链时反而可能以裸 URL 出现在结果里。留 noindex（页面侧在
  // dashboard/page.tsx 和 admin/metadata.ts），robots 只留 /api 这种没有 HTML 的端点。
  const text = await (await request.get("/robots.txt")).text();
  for (const path of ["/dashboard", "/admin"]) {
    expect(text).not.toContain(`Disallow: ${path}\n`);
  }

  // 爬虫抓 /dashboard 拿到的是 307 + 同样 noindex 的登录页，没有可收录的内容。
  const response = await page.goto("/dashboard");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.locator('head meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex, nofollow",
  );
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
