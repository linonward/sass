import { expect, test } from "@playwright/test";

import messages from "../../messages/en.json";
import siteConfig from "../../site.config";
import { TEST_LOCALE } from "./test-locale";

const tr = (text: string) => `[${TEST_LOCALE}] ${text}`;
const localeName = new Intl.DisplayNames([TEST_LOCALE], {
  type: "language",
}).of(TEST_LOCALE)!;

test("switching locale changes both the URL and the copy, and can switch back to the default locale", async ({
  page,
}) => {
  await page.goto("/");
  const html = page.locator("html");
  const nav = page.getByRole("navigation", { name: messages.Header.main });
  await expect(html).toHaveAttribute("lang", "en");
  await expect(
    nav.getByRole("link", { name: messages.Nav.delivery }),
  ).toBeVisible();

  await page.getByRole("button", { name: messages.Locale.switch }).click();
  await page.getByRole("menuitemradio", { name: localeName }).click();

  await expect(page).toHaveURL(`/${TEST_LOCALE}`);
  await expect(html).toHaveAttribute("lang", TEST_LOCALE);
  const localizedNav = page.getByRole("navigation", {
    name: tr(messages.Header.main),
  });
  await expect(
    localizedNav.getByRole("link", { name: tr(messages.Nav.delivery) }),
  ).toBeVisible();
  await expect(
    page.locator("#hero").getByRole("link", {
      name: tr(messages.Landing.hero.primaryCta),
      exact: true,
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: tr(messages.Locale.switch) }).click();
  await page.getByRole("menuitemradio", { name: "English" }).click();
  await expect(page).toHaveURL("/");
  await expect(html).toHaveAttribute("lang", "en");
});

test("visiting a prefixed path directly serves that locale", async ({
  page,
}) => {
  const response = await page.goto(`/${TEST_LOCALE}`);
  expect(response?.status()).toBe(200);
  await expect(
    page
      .locator("#hero")
      .getByRole("link", { name: tr(messages.Landing.hero.primaryCta) }),
  ).toBeVisible();
});

test("a prefixed default-locale path redirects to the unprefixed path", async ({
  page,
}) => {
  await page.goto("/en");
  await expect(page).toHaveURL("/");
});

test("the 404 page in a non-default locale uses that locale's copy", async ({
  page,
}) => {
  const response = await page.goto(`/${TEST_LOCALE}/does-not-exist`);
  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: tr(messages.NotFound.title) }),
  ).toBeVisible();
});

// The test above asserts on the hydrated DOM. Checking again with JS off pins down
// generateMetadata in [locale]/not-found.tsx: this used to be the site name, and it proves the
// title really follows the locale rather than being hard-coded in English.
test.describe("static HTML of the 404 in a non-default locale (JS off)", () => {
  test.use({ javaScriptEnabled: false });

  test("the title is that locale's 404 title, with noindex", async ({
    page,
  }) => {
    const response = await page.goto(`/${TEST_LOCALE}/does-not-exist`);
    expect(response?.status()).toBe(404);
    await expect(page).toHaveTitle(
      `${tr(messages.NotFound.title)} | ${siteConfig.name}`,
    );
    const robots = page.locator('meta[name="robots"]');
    await expect(robots).toHaveCount(1);
    await expect(robots).toHaveAttribute("content", "noindex");
  });
});

test("in a non-default locale, legal page body stays English while the chrome is localized", async ({
  page,
}) => {
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
