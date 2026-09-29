import { expect, test, type BrowserContext } from "@playwright/test";

import messages from "../../messages/en.json";
import { LOCALE_COOKIE } from "../../src/core/i18n/locale-cookie";
import { TEST_LOCALE } from "./test-locale";

const tr = (text: string) => `[${TEST_LOCALE}] ${text}`;

// Playwright's locale option sets both Accept-Language and navigator.language, which is exactly
// what browser language detection looks at.
const DE_BROWSER = { locale: TEST_LOCALE };
const EN_BROWSER = { locale: "en-US" };
/** A locale this site doesn't have: should fall back to the default locale, not redirect. */
const UNKNOWN_BROWSER = { locale: "fr-FR" };

/** Current value of the locale cookie; undefined if it was never written. */
async function localeCookie(context: BrowserContext) {
  const cookies = await context.cookies();
  return cookies.find((cookie) => cookie.name === LOCALE_COOKIE)?.value;
}

test.describe("browser language is one the site supports", () => {
  test.use(DE_BROWSER);

  test("home page redirects to that locale", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(`/${TEST_LOCALE}`);
    await expect(page.locator("html")).toHaveAttribute("lang", TEST_LOCALE);
  });

  test("deep links redirect too", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page).toHaveURL(`/${TEST_LOCALE}/pricing`);
    await expect(
      page.getByRole("navigation", { name: tr(messages.Header.main) }),
    ).toBeVisible();
  });

  // A prefix in the URL is a locale the user chose explicitly and takes top priority: a shared /zh
  // link isn't rewritten by the recipient's browser language.
  test("prefixed URLs aren't affected by browser language", async ({
    page,
  }) => {
    await page.goto("/zh/pricing");
    await expect(page).toHaveURL("/zh/pricing");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh");
  });

  // The redirect must be a 307: language preferences change, and a 301/308 is remembered long-term
  // by browsers and search engines with no way back.
  // Vary is for caches: which locale an unprefixed URL redirects to depends on Accept-Language, so
  // it has to be part of the cache key, or a Chinese visitor's redirect gets served to an English
  // visitor (and vice versa).
  // Only responses the middleware returns itself (redirects) can carry this header: Next rebuilds
  // Vary on 200 responses, so a value the middleware adds never reaches the client — see the
  // comment in src/proxy.ts, which also explains why that's enough.
  test("redirect is a 307 with Vary: Accept-Language", async ({ request }) => {
    const redirect = await request.get("/", {
      headers: { "accept-language": TEST_LOCALE },
      maxRedirects: 0,
    });
    expect(redirect.status()).toBe(307);
    expect(redirect.headers()["location"]).toBe(`/${TEST_LOCALE}`);
    expect(redirect.headers()["vary"]).toContain("Accept-Language");
  });

  // The proxy only adds Vary to unprefixed responses (a prefixed URL is always its own locale). This
  // is now a belt-and-braces check: whether the header comes from our code or from Next rebuilding
  // it, it shouldn't be on prefixed responses.
  test("prefixed URLs have no Vary", async ({ request }) => {
    const response = await request.get(`/${TEST_LOCALE}`, {
      headers: { "accept-language": "en-US" },
    });
    expect(response.status()).toBe(200);
    expect(response.headers()["vary"] ?? "").not.toContain("Accept-Language");
  });
});

test.describe("browser language isn't one the site has", () => {
  test.use(UNKNOWN_BROWSER);

  test("stays on the default locale without redirecting", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});

// "Visited a page in some locale" isn't the same as "chose that locale": a recipient who opens a
// shared /de link once shouldn't be sent to the German site forever when visiting the home page
// later. The cookie is only written by the locale switcher (core/i18n/locale-switcher.tsx), and
// the proxy deletes the one the middleware writes on its own (src/proxy.ts).
test.describe("visiting a prefixed URL doesn't write the locale cookie", () => {
  test.use(EN_BROWSER);

  test("an English visitor who opens a /de link still gets the English site on the home page afterwards", async ({
    page,
    context,
  }) => {
    await page.goto(`/${TEST_LOCALE}`);
    await expect(page.locator("html")).toHaveAttribute("lang", TEST_LOCALE);
    expect(await localeCookie(context)).toBeUndefined();

    await page.goto("/");
    await expect(page).toHaveURL("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});

test.describe("an explicit switch is remembered", () => {
  test.use(DE_BROWSER);

  test("after switching to English, the browser language no longer sends you back to the German site", async ({
    page,
    context,
  }) => {
    await page.goto("/");
    await expect(page).toHaveURL(`/${TEST_LOCALE}`);

    await page
      .getByRole("button", { name: tr(messages.Locale.switch) })
      .click();
    await page.getByRole("menuitemradio", { name: "English" }).click();
    await expect(page).toHaveURL("/");
    expect(await localeCookie(context)).toBe("en");

    // The cookie takes precedence over Accept-Language; otherwise switching to English in a
    // Chinese/German browser would only last for that one visit.
    await page.goto("/");
    await expect(page).toHaveURL("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});
