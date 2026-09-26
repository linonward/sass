import { expect, test } from "@playwright/test";

import messages from "../messages/en.json";
import siteConfig from "../site.config";

function hexToRgb(hex: string) {
  const digits = hex.slice(1);
  const full =
    digits.length === 3 ? [...digits].map((d) => d + d).join("") : digits;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

test("未知路径返回 404 页", async ({ page }) => {
  const response = await page.goto("/this-page-does-not-exist");
  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { level: 1, name: "Page not found" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Back to home" }).click();
  await expect(page).toHaveURL("/");
});

test("主按钮使用配置里的品牌色", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Get started" })).toHaveCSS(
    "background-color",
    hexToRgb(siteConfig.brand.primaryColor),
  );
});

test("暗色模式切换并在刷新后保持", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const html = page.locator("html");
  await expect(html).not.toHaveClass(/\bdark\b/);

  await page.getByRole("button", { name: "Toggle theme" }).click();
  await page.getByRole("menuitemradio", { name: "Dark" }).click();
  await expect(html).toHaveClass(/\bdark\b/);

  await page.reload();
  await expect(html).toHaveClass(/\bdark\b/);

  await page.getByRole("button", { name: "Toggle theme" }).click();
  await page.getByRole("menuitemradio", { name: "Light" }).click();
  await expect(html).not.toHaveClass(/\bdark\b/);
});

test.describe("375px 宽度", () => {
  test.use({ viewport: { width: 375, height: 740 } });

  for (const theme of ["light", "dark"] as const) {
    test(`${theme} 模式下页面不横向溢出`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto("/");
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test("移动端菜单可以打开并导航", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open menu" }).click();
    const menu = page.getByRole("navigation", { name: "Mobile" });
    const first = siteConfig.nav.header[0]!;
    await menu
      .getByRole("link", { name: messages.Nav[first.key as "features"] })
      .click();
    await expect(menu).toBeHidden();
    await expect(page).toHaveURL(first.href);
  });
});

test.describe("只有一门语言时", () => {
  test("不显示语言切换器", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Toggle theme" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: messages.Locale.switch }),
    ).toHaveCount(0);
  });

  test("未启用的语言前缀返回 404", async ({ page }) => {
    const response = await page.goto("/zh");
    expect(response?.status()).toBe(404);
    // 这条走 [locale]（proxy 把 /zh 当成无前缀路径重写），由 [locale]/not-found.tsx 接住。
    // 只断状态码会漏掉「退化成框架默认页」这种回归 —— 文案是客户端渲染的，curl 也看不到。
    await expect(
      page.getByRole("heading", { level: 1, name: messages.NotFound.title }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: messages.NotFound.back }),
    ).toHaveAttribute("href", "/");
  });

  test("被 proxy 跳过的带扩展名路径也返回 404", async ({ page }) => {
    const response = await page.goto("/missing.png");
    expect(response?.status()).toBe(404);
    // 这条路径不经过 [locale]，由根级 app/not-found.tsx 接住 —— 只断状态码会漏掉
    // 「退化成框架默认页」这种回归（文案是客户端渲染的，curl 也看不到）。
    await expect(
      page.getByRole("heading", { level: 1, name: "Page not found" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Back to home" }),
    ).toHaveAttribute("href", "/");
    // 根级 not-found 的 React <title>：静态 HTML 里没有 title（它在 client 边界里，
    // 水合后才进 head），所以只有水合后这一条能锁住「别退化成站名」。
    await expect(page).toHaveTitle(messages.NotFound.title);
  });

  test("未匹配的 API 路径返回 JSON 404", async ({ request }) => {
    const response = await request.get("/api/nope");
    expect(response.status()).toBe(404);
    expect(response.headers()["content-type"]).toContain("application/json");
    expect(await response.json()).toEqual({ error: "not_found" });
  });
});

// 404 的元数据。关 JS 是为了只测**服务端产出的那份 HTML**：水合之后 title 由 client 边界
// 决定，是另一条路径（见上面 /missing.png 里的水合断言）。
//
// 这里的 noindex 是**框架注入**的（app-render.js 的 NonIndex + client 边界的
// http-access-fallback 各注入一次，content 恰好是 "noindex"），别和
// src/core/seo/metadata.ts 的 noIndex 参数混为一谈 —— 那是页面自己声明的，渲染成
// "noindex, nofollow"（e2e/i18n/blog.spec.ts 断的是那一套）。所以这里同时断言
// 「只有一个 robots meta」和「content 精确等于 noindex」，两套机制分得开。
test.describe("404 的元数据（关 JS）", () => {
  test.use({ javaScriptEnabled: false });

  for (const path of ["/does-not-exist", "/zh"]) {
    test(`${path} 的静态 HTML 带本地化标题和 noindex`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
      // T903 之前这里是站名（React <title> 只在客户端生效，关 JS 就没了）——
      // 对关 JS 的爬虫来说，404 页标题和首页一模一样。
      await expect(page).toHaveTitle(
        `${messages.NotFound.title} | ${siteConfig.name}`,
      );
      const robots = page.locator('meta[name="robots"]');
      await expect(robots).toHaveCount(1);
      await expect(robots).toHaveAttribute("content", "noindex");
    });
  }

  test("/missing.png 带 noindex，且静态 HTML 不冒用站名当标题", async ({
    page,
  }) => {
    const response = await page.goto("/missing.png");
    expect(response?.status()).toBe(404);

    const robots = page.locator('meta[name="robots"]');
    await expect(robots).toHaveCount(1);
    await expect(robots).toHaveAttribute("content", "noindex");

    // 这条路径由根级 app/not-found.tsx 接住，它渲染在框架给的 client 边界里：React
    // <title> 要水合后才进 head，所以静态 HTML 里一个 title 都没有（今天就是 undefined）。
    // 要锁的是「别退化成 layout 的站名标题」—— 那等于告诉搜索引擎这是正常首页。
    // 不断言「必须是空」，是为了让「给根级 404 补一个服务端标题」这种改进不被挡。
    const html = (await response?.text()) ?? "";
    const title = /<title[^>]*>([\s\S]*?)<\/title>/.exec(html)?.[1];
    expect(title).not.toBe(siteConfig.name);
  });
});
