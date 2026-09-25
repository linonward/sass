import { expect, test } from "@playwright/test";

test("首页返回 200 并渲染标题", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
