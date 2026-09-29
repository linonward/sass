import { expect, test } from "@playwright/test";

import messages from "../messages/en.json";
import { stubGoogleOneTap } from "./auth-helpers";

// No horizontal overflow at 375px is a hard rule of the template, but the assertions are spread
// across the per-page specs (ui-shell only covers the marketing home page; there are also blog,
// legal, dashboard, admin). This adds two entry points that previously had no coverage at all
// yet both have to hold up as full pages:
//
// - 404: `src/app/[locale]/not-found.tsx` renders its own SiteHeader (sticky + hard lip shadow),
//   SiteFooter, and the marketing 44px sticker button — it lives under [locale]/ and doesn't get
//   the marketing layout, so there's no other CI guard against style regressions.
//   `/missing.png` goes through the root `src/app/not-found.tsx`: no Header / Footer, but it
//   shares the same 404 register and that 44px button, so it's pinned down too.
// - `/sign-in`: the `(auth)` group layout + form + two inline links at the end, the narrowest
//   product page an anonymous visitor can reach (and the only product page that renders the full
//   layout without signing in).
//
// Measured the same way as existing specs: `documentElement.scrollWidth - window.innerWidth`.
// Assert some content before measuring — if the page degrades to blank (render error), the width
// assertion would pass falsely.
test.describe("375px width", () => {
  test.use({ viewport: { width: 375, height: 740 } });

  for (const theme of ["light", "dark"] as const) {
    test(`${theme} mode: 404 page doesn't overflow horizontally`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: theme });
      // /de is a "locale prefix that isn't enabled": the proxy rewrites it as an unprefixed path, and
      // it's also caught by the [locale] not-found (the two entry points have different locales, so
      // they cover different resolution paths).
      for (const path of ["/does-not-exist", "/de", "/missing.png"]) {
        const response = await page.goto(path);
        expect(response?.status()).toBe(404);
        await expect(
          page.getByRole("heading", {
            level: 1,
            name: messages.NotFound.title,
          }),
        ).toBeVisible();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(overflow, path).toBeLessThanOrEqual(0);
      }
    });
  }

  test.describe("sign-in page", () => {
    // With Google credentials in the local `.env.local`, the sign-in page really loads the GIS script
    // and tries to show One Tap — that prompt is Google's own fixed-position iframe, whose width isn't
    // constrained by this site's styles. Stub it out so the measured width belongs to the page alone
    // (CI has no credentials, so the script never loads there anyway).
    test.beforeEach(async ({ page }) => {
      await stubGoogleOneTap(page);
    });

    for (const theme of ["light", "dark"] as const) {
      test(`${theme} mode doesn't overflow horizontally`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: theme });
        const response = await page.goto("/sign-in");
        expect(response?.status()).toBe(200);
        await expect(
          page.getByLabel(messages.Auth.signIn.emailLabel),
        ).toBeVisible();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }
  });
});
