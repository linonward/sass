import { expect, test } from "@playwright/test";

import messages from "../messages/en.json";
import siteConfig from "../site.config";
import { waitForEmail } from "../src/core/email/testing";
import {
  enterCode,
  openUserMenu,
  requestCode,
  stubGoogleOneTap,
  uniqueEmail,
  useRandomIp,
  withDatabase,
} from "./auth-helpers";

const t = messages.Auth;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const { allowedAttempts, resendCooldown } = siteConfig.auth.emailOtp;

test.beforeEach(async ({ page }) => {
  await useRandomIp(page);
  // With Google credentials configured locally, the sign-in page loads the GIS script; this file
  // only cares about the verification-code flow.
  await stubGoogleOneTap(page);
});

test("verification-code sign-in lands on onboarding, the dashboard shows a greeting, and first sign-up gets a welcome email", async ({
  page,
}) => {
  const email = uniqueEmail("login");
  const { code } = await requestCode(page, email);
  await enterCode(page, code);

  // A new user's first stop after sign-up is onboarding (details covered by onboarding.spec.ts).
  await expect(page).toHaveURL("/onboarding");
  await page.goto("/dashboard");
  await expect(page.getByTestId("signed-in-as")).toHaveText(
    messages.Dashboard.home.welcome.replace("{email}", email),
  );
  const welcome = await waitForEmail({ to: email, template: "welcome" });
  expect(welcome.subject).toContain(siteConfig.name);

  // Visiting the sign-in page while signed in sends you back to the dashboard.
  await page.goto("/sign-in");
  await expect(page).toHaveURL("/dashboard");
});

test("without Google credentials, no Google button is shown and the GIS script isn't loaded", async ({
  page,
}) => {
  test.skip(
    Boolean(process.env.GOOGLE_CLIENT_ID),
    "skipped when Google credentials are configured locally",
  );

  // One Tap and the button share a source (both driven by the Google client ID): without
  // credentials not even the script should load, and the CSP allowlist isn't widened either (see
  // src/core/security/headers.test.ts).
  const googleRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("accounts.google.com")) {
      googleRequests.push(request.url());
    }
  });

  await page.goto("/sign-in");
  await expect(page.getByLabel(t.signIn.emailLabel)).toBeVisible();
  await expect(page.getByRole("button", { name: t.signIn.google })).toHaveCount(
    0,
  );
  expect(googleRequests).toEqual([]);
});

test(`after ${allowedAttempts} wrong verification codes, the correct one is invalid too`, async ({
  page,
}) => {
  const email = uniqueEmail("attempts");
  const { code } = await requestCode(page, email);
  const wrong = code === "000000" ? "111111" : "000000";

  for (let i = 0; i < allowedAttempts; i++) {
    await enterCode(page, wrong);
    await expect(page.getByTestId("auth-error")).toHaveText(
      t.errors.invalidCode,
    );
  }
  await enterCode(page, code);
  await expect(page.getByTestId("auth-error")).toHaveText(
    t.errors.tooManyAttempts,
  );
  await expect(page).toHaveURL(/\/sign-in/);
});

test("verification code stops working after it expires", async ({ page }) => {
  const email = uniqueEmail("expired");
  const { code } = await requestCode(page, email);

  // Don't wait the real 5 minutes: move this code's expiry into the past.
  const updated = await withDatabase((db) =>
    db.query(
      "update verification set expires_at = now() - interval '1 minute' where identifier = $1",
      [`sign-in-otp-${email}`],
    ),
  );
  expect(updated.rowCount).toBe(1);

  await enterCode(page, code);
  // Better Auth cleans up all expired records while looking up a code: it returns OTP_EXPIRED if
  // the record is still there, and INVALID_OTP if another request already cleaned it up. Either way
  // the code is no longer valid.
  await expect(page.getByTestId("auth-error")).toHaveText(
    new RegExp(
      `^(${escape(t.errors.codeExpired)}|${escape(t.errors.invalidCode)})$`,
    ),
  );
  await expect(page).toHaveURL(/\/sign-in/);
});

test(`can't resend a verification code within ${resendCooldown} seconds`, async ({
  page,
}) => {
  const email = uniqueEmail("cooldown");
  await requestCode(page, email);

  const resend = page.getByRole("button", { name: /Resend/ });
  await expect(resend).toBeDisabled();
  await expect(resend).toHaveText(/Resend in \d+s/);

  // Bypassing the UI and calling the endpoint directly, the server rejects it as well.
  const response = await page.request.post(
    "/api/auth/email-otp/send-verification-otp",
    { data: { email, type: "sign-in" } },
  );
  expect(response.status()).toBe(429);
  expect(await response.json()).toMatchObject({ code: "RESEND_COOLDOWN" });
  expect(Number(response.headers()["retry-after"])).toBeGreaterThan(0);

  // Switch to another email and back; resubmitting the same email shows the cooldown message
  // right away.
  await page.getByRole("button", { name: t.signIn.changeEmail }).click();
  await page.getByLabel(t.signIn.emailLabel).fill(email);
  await page.getByRole("button", { name: t.signIn.sendCode }).click();
  await expect(page.getByTestId("auth-error")).toContainText(/wait \d+s/);
  await expect(page.getByLabel(t.signIn.codeLabel)).toBeVisible();
});

test("signed-out visit to a protected page redirects to sign-in, then back to the original page after sign-in", async ({
  page,
}) => {
  await page.goto("/dashboard?from=e2e");
  await expect(page).toHaveURL(
    `/sign-in?callbackURL=${encodeURIComponent("/dashboard?from=e2e")}`,
  );

  const { code } = await requestCode(page, uniqueEmail("callback"));
  await enterCode(page, code);
  await expect(page).toHaveURL("/dashboard?from=e2e");
});

test("off-site callbackURL is ignored", async ({ page }) => {
  await page.goto(
    `/sign-in?callbackURL=${encodeURIComponent("https://evil.example/")}`,
  );
  const { code } = await requestCode(page, uniqueEmail("redirect"));
  await enterCode(page, code);
  await expect(page).toHaveURL("/dashboard");
});

// JS off = the extreme case of "never hydrates". Submitting before onSubmit is attached falls
// back to the browser's native form GET: the whole URL is replaced with `/sign-in?email=…`, the
// callbackURL is lost, and users coming from a protected page or a referral link land on
// onboarding after sign-in instead of their original target. On real devices this only happens
// on slow networks / mobile; local dev reproduces it reliably.
test.describe("sign-in form can't be submitted before hydration (JS off)", () => {
  test.use({ javaScriptEnabled: false });

  test("submitting the email doesn't wipe out callbackURL", async ({
    page,
  }) => {
    await page.goto(
      `/sign-in?callbackURL=${encodeURIComponent("/dashboard?from=e2e")}`,
    );
    await expect(
      page.getByRole("button", { name: t.signIn.sendCode }),
    ).toBeDisabled();

    // Enter is the other native submission path (implicit form submission); disabling the submit
    // button blocks it too.
    const email = page.getByLabel(t.signIn.emailLabel);
    await email.fill("hydration@example.com");
    await email.press("Enter");

    await expect(page).toHaveURL(/callbackURL=/);
  });
});

test("after signing out from the user menu, the dashboard is no longer accessible", async ({
  page,
  isMobile,
}) => {
  const { code } = await requestCode(page, uniqueEmail("signout"));
  await enterCode(page, code);
  await expect(page).toHaveURL("/onboarding");
  // Onboarding has a sidebar too, but the sign-out case belongs to the dashboard, so go back
  // there first.
  await page.goto("/dashboard");

  await openUserMenu(page, isMobile);
  await page
    .getByRole("menuitem", { name: messages.Dashboard.userMenu.signOut })
    .click();
  await expect(page).toHaveURL("/sign-in");

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in\?callbackURL=/);
});
