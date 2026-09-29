import { expect, test, type Page } from "@playwright/test";

import messages from "../messages/en.json";
import { placeholderIssues } from "../src/core/config/sentinels";
import siteConfig from "../site.config";
import {
  clearResendCooldown,
  openUserMenu,
  signIn,
  stubGoogleOneTap,
  uniqueEmail,
  useRandomIp,
  withDatabase,
} from "./auth-helpers";

const o = messages.Onboarding;
const d = messages.Dashboard;

/**
 * Whether the out-of-the-box placeholders are all still there.
 *
 * CI overrides the site name and plan product IDs with branded values via SITE_NAME /
 * CREEM_PRODUCT_ID_* (see .github/workflows/ci.yml; it's so the placeholder guard in `pnpm build`
 * passes), while local dev keeps the defaults. The checklist's checks follow the config, so the
 * assertions branch too — both sides must pass.
 */
const placeholdersGone = placeholderIssues(siteConfig).length === 0;

test.beforeEach(async ({ page }) => {
  await useRandomIp(page);
  // With Google credentials configured locally, the sign-in page loads the GIS script; this file
  // only cares about the verification-code flow.
  await stubGoogleOneTap(page);
});

/** Get a row by data-step, independent of copy order. */
function step(page: Page, id: string) {
  return page.locator(`[data-testid="onboarding-step"][data-step="${id}"]`);
}

/** The completion flag on the user record: not visible in the UI, only via the database. */
async function completedFlag(email: string) {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ onboarding_completed: boolean }>(
      'select onboarding_completed from "user" where email = $1',
      [email],
    );
    return rows[0]?.onboarding_completed;
  });
}

/**
 * Check off the steps that can't be detected (write a post, deploy). When running on Vercel the
 * deploy step completes automatically and has no checkbox.
 */
async function tickManualSteps(page: Page) {
  for (const id of ["blogPost", "deploy"]) {
    const box = step(page, id).getByRole("checkbox");
    if (await box.count()) await box.check();
    await expect(step(page, id)).toHaveAttribute("data-status", "done");
  }
}

test("new users land on the checklist after sign-up, and marking it done is saved to the user record", async ({
  page,
}) => {
  const email = uniqueEmail("onboarding");
  await signIn(page, email);
  await expect(page).toHaveURL("/onboarding");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(o.title);

  await expect(page.getByTestId("onboarding-step")).toHaveCount(5);
  // Each of the three navigable steps has an "Open" link. This pins the role: it must be a link
  // (it navigates), not a button — see checklist.tsx for why these two don't use Base UI's Button.
  await expect(
    page.getByTestId("onboarding-step").getByRole("link"),
  ).toHaveCount(3);
  // The brand color has no env var override: while the default is still there this step should be
  // todo, listing the unchanged value.
  await expect(step(page, "brandColor")).toHaveAttribute("data-status", "todo");
  await expect(step(page, "brandColor")).toContainText("#0f766e");
  // The checks for site name and plan product IDs depend on the environment (see
  // placeholdersGone).
  for (const id of ["siteName", "pricing"]) {
    await expect(step(page, id)).toHaveAttribute(
      "data-status",
      placeholdersGone ? "done" : "todo",
    );
  }
  if (!placeholdersGone) {
    // Unchanged defaults are listed verbatim so the buyer knows what to change.
    await expect(step(page, "siteName")).toContainText('name = "Acme"');
    await expect(step(page, "pricing")).toContainText("prod_placeholder_pro");
  }

  // Checking manual items only affects the current page: the user record is still "not done".
  await tickManualSteps(page);
  expect(await completedFlag(email)).toBeFalsy();

  await page.getByTestId("onboarding-complete").click();
  await expect(page).toHaveURL("/dashboard");
  expect(await completedFlag(email)).toBe(true);
});

test("after marking done, signing in again goes straight in with no redirect; the checklist is still reachable from the sidebar", async ({
  page,
  isMobile,
}) => {
  const email = uniqueEmail("onboarding-done");
  await signIn(page, email);
  await expect(page).toHaveURL("/onboarding");
  await page.getByTestId("onboarding-complete").click();
  await expect(page).toHaveURL("/dashboard");

  // Sign out and back in: users who are done get no extra redirect.
  await openUserMenu(page, isMobile);
  await page.getByRole("menuitem", { name: d.userMenu.signOut }).click();
  await expect(page).toHaveURL("/sign-in");
  await clearResendCooldown(email);
  await signIn(page, email);
  await expect(page).toHaveURL("/dashboard");

  // The sidebar always has this entry; it just no longer prompts "mark as done".
  if (isMobile) {
    await page.getByRole("button", { name: d.toggleSidebar }).click();
  }
  await page
    .getByRole("list", { name: d.businessNav })
    .getByRole("link", { name: d.nav.onboarding })
    .click();
  await expect(page).toHaveURL("/onboarding");
  await expect(page.getByTestId("onboarding-completed-at")).toBeVisible();
  await expect(page.getByTestId("onboarding-complete")).toHaveCount(0);
});

test("sign-in with a callbackURL respects the deep link and skips the checklist", async ({
  page,
}) => {
  const email = uniqueEmail("onboarding-callback");
  await page.goto("/example");
  await expect(page).toHaveURL(/\/sign-in\?callbackURL=%2Fexample/);

  await signIn(page, email);
  await expect(page).toHaveURL("/example");
  // A deep-link sign-in doesn't count as "seen the checklist": the user record is still not done.
  expect(await completedFlag(email)).toBeFalsy();
});
