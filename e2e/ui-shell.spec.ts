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
    const first = siteConfig.nav.header[0];
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
  });

  test("被 proxy 跳过的带扩展名路径也返回 404", async ({ page }) => {
    const response = await page.goto("/missing.png");
    expect(response?.status()).toBe(404);
  });
});
