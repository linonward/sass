import { expect, test } from "@playwright/test";

import messages from "../messages/en.json";
import { useRandomIp } from "./auth-helpers";

/**
 * Wiring test for Google One Tap, **local only**:
 *
 * - CI's env has no Google credentials (see `.github/workflows/ci.yml`), and the CSP is computed
 *   at build time (`headers()` in `next.config.ts`), so in CI the sign-in page never loads the
 *   GIS script at all — the requests stubbed here are never sent.
 * - The success path can't be faked: `/one-tap/callback` verifies the signature live against
 *   Google's JWKS (better-auth has neither a cache nor an override hook), so a fake ID token can
 *   only fail. Real sign-in is verified manually.
 *
 * So what this case really pins down is "the CSP allows the GIS script + the client wiring is
 * correct": if the allowlist misses the GIS origin, the script request never goes out, the stub
 * below is never hit, and the test fails with a timeout.
 */
test.skip(
  !process.env.GOOGLE_CLIENT_ID,
  "skipped when Google credentials aren't configured locally",
);

test.beforeEach(async ({ page }) => {
  await useRandomIp(page);
});

test("One Tap: prompt → get credential → call the callback endpoint, surfacing failures", async ({
  page,
}) => {
  // Replace GIS with a fake that "immediately clicks the avatar".
  await page.route("https://accounts.google.com/gsi/client*", (route) =>
    route.fulfill({
      // Must be a JS MIME type: Playwright defaults to text/plain, which nosniff blocks.
      contentType: "application/javascript",
      body: `window.google = { accounts: { id: {
        initialize(config) { window.__oneTapCallback = config.callback; },
        prompt() {
          window.__oneTapCallback?.({ credential: "e2e-fake-id-token" });
        },
      } } };`,
    }),
  );

  const callback = page.waitForRequest((request) =>
    request.url().includes("/one-tap/callback"),
  );

  await page.goto("/sign-in");

  const request = await callback;
  expect(request.method()).toBe("POST");
  const body = request.postDataJSON();
  expect(body.idToken).toBe("e2e-fake-id-token");
  // callbackURL must make it all the way to the server: the plugin uses it to decide where to go
  // after sign-in, and without it silently doesn't redirect.
  expect(String(body.callbackURL)).toContain("/dashboard");

  // The fake token fails server-side signature verification, so a failure message must show (the
  // plugin itself just returns silently; the error is surfaced by src/core/auth/one-tap.ts via
  // fetchOptions.onError).
  await expect(page.getByTestId("auth-error")).toHaveText(
    messages.Auth.errors.googleFailed,
  );
});
