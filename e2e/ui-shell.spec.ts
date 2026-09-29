import { expect, test, type Page } from "@playwright/test";

import messages from "../messages/en.json";
import siteConfig from "../site.config";

function hexToRgb(hex: string) {
  const digits = hex.slice(1);
  const full =
    digits.length === 3 ? [...digits].map((d) => d + d).join("") : digits;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

test("unknown paths return the 404 page", async ({ page }) => {
  const response = await page.goto("/this-page-does-not-exist");
  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { level: 1, name: "Page not found" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Back to home" }).click();
  await expect(page).toHaveURL("/");
});

// The hero's primary button: with a purchasable plan it's "Buy now · price" (the CI config sells
// lifetime).
const heroPrimary = (page: Page) =>
  page.locator("#hero").getByRole("link", {
    name: new RegExp(`^${messages.Landing.hero.buyCta.split(" ·")[0]}`),
  });

test("primary button uses the configured brand color", async ({ page }) => {
  await page.goto("/");
  await expect(heroPrimary(page)).toHaveCSS(
    "background-color",
    hexToRgb(siteConfig.brand.primaryColor),
  );
});

test("dark mode toggles and persists after reload", async ({ page }) => {
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

test("brand color preview works with light, dark, and system themes, and reverts to config after leaving the home page", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const colors = page.getByRole("radiogroup", {
    name: messages.Landing.hero.colorSwitcher.label,
  });
  const indigo = colors.getByRole("radio", { name: /#4f46e5/ });
  await indigo.click();
  await expect(indigo).toHaveAttribute("aria-checked", "true");
  const primary = heroPrimary(page);
  await expect(primary).toHaveCSS("background-color", hexToRgb("#4f46e5"));
  const background = () =>
    page.locator("body").evaluate((el) => getComputedStyle(el).backgroundColor);
  const light = await background();
  await page.getByRole("button", { name: "Toggle theme" }).click();
  await page.getByRole("menuitemradio", { name: "Dark", exact: true }).click();
  await expect.poll(background).not.toBe(light);
  await expect(primary).toHaveCSS("background-color", hexToRgb("#4f46e5"));
  await page
    .getByRole("menuitemradio", { name: "System", exact: true })
    .click();
  await expect.poll(background).toBe(light);
  await page.keyboard.press("Escape");
  await indigo.press("Home");
  await expect(colors.getByRole("radio").first()).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await indigo.click();
  // Leave the home page: the primary button stays on this page (jumps to the delivery section),
  // so use the hero's demo link.
  await page
    .locator("#hero")
    .getByRole("link", { name: messages.Landing.hero.primaryCta, exact: true })
    .click();
  await expect(page).toHaveURL("/demo");
  await expect
    .poll(() =>
      page
        .locator("html")
        .evaluate((el) =>
          getComputedStyle(el).getPropertyValue("--primary").trim(),
        ),
    )
    .toBe(siteConfig.brand.primaryColor);
});

test.describe("375px width", () => {
  test.use({ viewport: { width: 375, height: 740 } });

  for (const theme of ["light", "dark"] as const) {
    test(`${theme} mode: page doesn't overflow horizontally`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto("/");
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test("mobile menu opens and navigates", async ({ page }) => {
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

test.describe("with two locales", () => {
  test("shows the locale switcher and can switch to Chinese", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Toggle theme" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: messages.Locale.switch }),
    ).toBeVisible();

    // Switch to Chinese
    await page.getByRole("button", { name: messages.Locale.switch }).click();
    const zhName = new Intl.DisplayNames(["zh"], { type: "language" }).of(
      "zh",
    )!;
    await page.getByRole("menuitemradio", { name: zhName }).click();
    await expect(page).toHaveURL("/zh");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh");
  });

  test("a locale prefix that isn't enabled returns 404", async ({ page }) => {
    const response = await page.goto("/de");
    expect(response?.status()).toBe(404);
    // This goes through [locale] (the proxy rewrites /zh as an unprefixed path) and is caught by
    // [locale]/not-found.tsx. Asserting only the status code would miss a regression like "degraded
    // to the framework's default page" — the copy is client-rendered, so curl can't see it either.
    await expect(
      page.getByRole("heading", { level: 1, name: messages.NotFound.title }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: messages.NotFound.back }),
    ).toHaveAttribute("href", "/");
  });

  test("paths with extensions that the proxy skips also return 404", async ({
    page,
  }) => {
    const response = await page.goto("/missing.png");
    expect(response?.status()).toBe(404);
    // This path doesn't go through [locale]; it's caught by the root app/not-found.tsx — asserting
    // only the status code would miss a regression like "degraded to the framework's default page"
    // (the copy is client-rendered, so curl can't see it either).
    await expect(
      page.getByRole("heading", { level: 1, name: "Page not found" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Back to home" }),
    ).toHaveAttribute("href", "/");
    // The root not-found's React <title>: the static HTML has no title (it's inside a client
    // boundary and only enters the head after hydration), so only this post-hydration check can pin
    // down "don't degrade to the site name".
    await expect(page).toHaveTitle(messages.NotFound.title);
  });

  test("unmatched API paths return a JSON 404", async ({ request }) => {
    const response = await request.get("/api/nope");
    expect(response.status()).toBe(404);
    expect(response.headers()["content-type"]).toContain("application/json");
    expect(await response.json()).toEqual({ error: "not_found" });
  });
});

// 404 metadata. JS is off so this tests only **the HTML the server produces**: after hydration
// the title is decided by the client boundary, which is a different path (see the hydration
// assertion in /missing.png above).
//
// The noindex here is **injected by the framework** (once by NonIndex in app-render.js and once
// by the client boundary's http-access-fallback, with content exactly "noindex"). Don't confuse it
// with the noIndex parameter in src/core/seo/metadata.ts — that one is declared by the page itself
// and renders as "noindex, nofollow" (e2e/i18n/blog.spec.ts asserts that one). So this asserts
// both "exactly one robots meta" and "content is exactly noindex", keeping the two mechanisms
// apart.
test.describe("404 metadata (JS off)", () => {
  test.use({ javaScriptEnabled: false });

  for (const path of ["/does-not-exist", "/de"]) {
    test(`${path}: static HTML has a localized title and noindex, and doesn't inherit the home page canonical`, async ({
      page,
    }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
      // This used to be the site name (the React <title> only applies on the client and is gone with
      // JS off) — to a crawler without JS, the 404 page's title was identical to the home page's.
      await expect(page).toHaveTitle(
        `${messages.NotFound.title} | ${siteConfig.name}`,
      );
      const robots = page.locator('meta[name="robots"]');
      await expect(robots).toHaveCount(1);
      await expect(robots).toHaveAttribute("content", "noindex");

      // A 404 has no canonical URL of its own. This page's head used to carry the one from
      // [locale]/layout.tsx — canonical and hreflang both pointed at the home page (Next shallow-merges
      // metadata per field, so fields not-found doesn't set are inherited from the layout), which to a
      // crawler declares "this page is the home page".
      const head = page.locator("head");
      await expect(head.locator('link[rel="canonical"]')).toHaveCount(0);
      await expect(head.locator('link[rel="alternate"]')).toHaveCount(0);
      // The same inheritance hit og / twitter too: og:url used to point at the home page and the
      // title used to be the site name.
      await expect(head.locator('meta[property="og:url"]')).toHaveCount(0);
      await expect(head.locator('meta[property="og:title"]')).toHaveAttribute(
        "content",
        `${messages.NotFound.title} | ${siteConfig.name}`,
      );
      await expect(head.locator('meta[name="twitter:title"]')).toHaveAttribute(
        "content",
        `${messages.NotFound.title} | ${siteConfig.name}`,
      );
    });
  }

  test("/missing.png has noindex, and its static HTML doesn't borrow the site name as its title", async ({
    page,
  }) => {
    const response = await page.goto("/missing.png");
    expect(response?.status()).toBe(404);

    const robots = page.locator('meta[name="robots"]');
    await expect(robots).toHaveCount(1);
    await expect(robots).toHaveAttribute("content", "noindex");

    // This path is caught by the root app/not-found.tsx, which renders inside the client boundary
    // the framework provides: the React <title> only enters the head after hydration, so the static
    // HTML has no title at all (currently undefined). What must be pinned is "don't degrade to the
    // layout's site-name title" — that would tell search engines this is a normal home page.
    // It doesn't assert "must be empty", so an improvement like "give the root 404 a server-side
    // title" isn't blocked.
    const html = (await response?.text()) ?? "";
    const title = /<title[^>]*>([\s\S]*?)<\/title>/.exec(html)?.[1];
    expect(title).not.toBe(siteConfig.name);
  });
});
