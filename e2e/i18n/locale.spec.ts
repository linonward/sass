import { expect, test } from "@playwright/test";

import messages from "../../messages/en.json";
import { TEST_LOCALE } from "./test-locale";

const tr = (text: string) => `[${TEST_LOCALE}] ${text}`;
const localeName = new Intl.DisplayNames([TEST_LOCALE], {
  type: "language",
}).of(TEST_LOCALE)!;

test("切换语言后 URL 与文案都变化，并能切回默认语言", async ({ page }) => {
  await page.goto("/");
  const html = page.locator("html");
  const nav = page.getByRole("navigation", { name: messages.Header.main });
  await expect(html).toHaveAttribute("lang", "en");
  await expect(
    nav.getByRole("link", { name: messages.Nav.pricing }),
  ).toBeVisible();

  await page.getByRole("button", { name: messages.Locale.switch }).click();
  await page.getByRole("menuitemradio", { name: localeName }).click();

  await expect(page).toHaveURL(`/${TEST_LOCALE}`);
  await expect(html).toHaveAttribute("lang", TEST_LOCALE);
  const localizedNav = page.getByRole("navigation", {
    name: tr(messages.Header.main),
  });
  await expect(
    localizedNav.getByRole("link", { name: tr(messages.Nav.pricing) }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: tr(messages.Home.cta) }),
  ).toBeVisible();

  await page.getByRole("button", { name: tr(messages.Locale.switch) }).click();
  await page.getByRole("menuitemradio", { name: "English" }).click();
  await expect(page).toHaveURL("/");
  await expect(html).toHaveAttribute("lang", "en");
});

test("直接访问带前缀的路径返回对应语言", async ({ page }) => {
  const response = await page.goto(`/${TEST_LOCALE}`);
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("link", { name: tr(messages.Home.cta) }),
  ).toBeVisible();
});

test("默认语言带前缀时重定向到无前缀路径", async ({ page }) => {
  await page.goto("/en");
  await expect(page).toHaveURL("/");
});

test("非默认语言下的 404 页使用该语言文案", async ({ page }) => {
  const response = await page.goto(`/${TEST_LOCALE}/does-not-exist`);
  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: tr(messages.NotFound.title) }),
  ).toBeVisible();
});

test("非默认语言下法律页正文保持英文，外框本地化", async ({ page }) => {
  const response = await page.goto(`/${TEST_LOCALE}/privacy`);
  expect(response?.status()).toBe(200);
  await expect(page.locator("article")).toHaveAttribute("lang", "en");
  await expect(
    page.getByRole("heading", { level: 1, name: messages.Nav.privacy }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: tr(messages.Nav.legal) }),
  ).toBeVisible();
});
