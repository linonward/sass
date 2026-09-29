import { randomInt, randomUUID } from "node:crypto";

import { expect, type Page } from "@playwright/test";
import pg from "pg";

import messages from "../messages/en.json";
import { cooldownIdentifier } from "../src/core/auth/cooldown";
import { waitForEmail } from "../src/core/email/testing";

/** Each test uses its own email so tests don't interfere. */
export function uniqueEmail(tag: string) {
  return `e2e-${tag}-${randomUUID().slice(0, 8)}@example.com`;
}

/**
 * Pin the page to a random client IP. Production builds enable Better Auth's per-IP rate limit,
 * so each test uses a different IP to avoid tripping each other's limits when run in parallel.
 */
export async function useRandomIp(page: Page) {
  const ip = `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
  // Set on the context so both page requests and direct page.request calls carry it.
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": ip });
}

/**
 * Replace the GIS script with a fake where "the browser has no Google session".
 *
 * With Google credentials in the local `.env.local`, the sign-in page really loads the
 * `accounts.google.com` script and tries to show the One Tap prompt. Verification-code tests
 * don't care about it; stubbing it out keeps them deterministic and independent of Google's
 * availability. The real wiring is covered by `e2e/sign-in-one-tap.spec.ts`.
 */
export async function stubGoogleOneTap(page: Page) {
  await page.route("https://accounts.google.com/gsi/client*", (route) =>
    route.fulfill({
      // Must be a JS MIME type: Playwright defaults to text/plain, which nosniff blocks.
      contentType: "application/javascript",
      body: `window.google = { accounts: { id: {
        initialize() {},
        prompt(notify) {
          // Tell the plugin the prompt wasn't displayed so it can wrap up — its internal
          // in-flight flag only resets when it gets this notification.
          notify?.({ isNotDisplayed: () => true, getNotDisplayedReason: () => "opt_out_or_no_session" });
        },
      } } };`,
    }),
  );
}

type Copy = typeof messages;

/** Submit the email on the sign-in page and read the verification code from `.tmp/emails/`. */
export async function requestCode(
  page: Page,
  email: string,
  {
    copy = messages,
    signInPath = "/sign-in",
    outboxDir,
  }: { copy?: Copy; signInPath?: string; outboxDir?: string } = {},
) {
  const since = new Date(Date.now() - 1000);
  if (!page.url().includes("/sign-in")) await page.goto(signInPath);
  // Values filled in before hydration finishes get reset by React, and clicking only reports an
  // invalid email (no request is sent), so repeat "fill and send" until the code input appears.
  // The click inside the loop must be bounded (same reason as openUserMenu): the submit button is
  // disabled until hydration finishes, and the default 30s click would keep waiting for it to be
  // enabled, burning the whole toPass budget — which turns into a failure in slow-hydrating
  // environments (the i18n copy, a cold-started dev server). Fail each round fast so retries get a
  // chance to wait out hydration.
  await expect(async () => {
    await page.getByLabel(copy.Auth.signIn.emailLabel).fill(email);
    await page
      .getByRole("button", { name: copy.Auth.signIn.sendCode })
      .click({ timeout: 1000 });
    await expect(page.getByLabel(copy.Auth.signIn.codeLabel)).toBeVisible({
      timeout: 2000,
    });
  }).toPass({ timeout: 15_000 });
  const mail = await waitForEmail(
    { to: email, template: "sign-in-code", since },
    outboxDir ? { dir: outboxDir } : undefined,
  );
  return { code: String(mail.props.code), mail };
}

/** Type the verification code (it auto-submits once all digits are entered). */
export async function enterCode(
  page: Page,
  code: string,
  copy: Copy = messages,
) {
  await page.getByLabel(copy.Auth.signIn.codeLabel).fill(code);
}

/**
 * Connect directly to the app's database, to set up states you can't wait for, like "verification
 * code expired".
 */
export async function withDatabase<T>(run: (client: pg.Client) => Promise<T>) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/** Complete a verification-code sign-in and stop on the post-sign-in page. */
export async function signIn(
  page: Page,
  email: string,
  options: Parameters<typeof requestCode>[2] = {},
) {
  const { code } = await requestCode(page, email, options);
  await enterCode(page, code, options.copy);
  // Wait for the redirect to finish (session cookie written) before continuing.
  await page.waitForURL((url) => !url.pathname.endsWith("/sign-in"));
}

/**
 * Clear an email's verification-code resend cooldown so the same test can sign in again right
 * away.
 */
export async function clearResendCooldown(email: string) {
  await withDatabase((client) =>
    client.query("delete from verification where identifier = $1", [
      cooldownIdentifier(email),
    ]),
  );
}

/** Look up a user id by email; undefined if not found. */
export async function findUserId(email: string) {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      'select id from "user" where email = $1',
      [email],
    );
    return rows[0]?.id;
  });
}

/** Open the user menu in the sidebar (on mobile, open the drawer first). */
export async function openUserMenu(page: Page, isMobile: boolean) {
  const d = messages.Dashboard;
  // Clicks do nothing before hydration finishes, so keep clicking until the menu really appears.
  // Every action in the loop must be bounded: the config has no actionTimeout, so one missed click
  // waits until the test times out (30s), burning toPass's whole 10s budget — the block then never
  // retries, which shows up in CI as intermittent failures. Fail each round fast so retries get a
  // chance to wait out hydration.
  await expect(async () => {
    if (isMobile) {
      const trigger = page.getByRole("button", { name: d.userMenu.open });
      if (!(await trigger.isVisible())) {
        await page
          .getByRole("button", { name: d.toggleSidebar })
          .click({ timeout: 1000 });
      }
    }
    await page
      .getByRole("button", { name: d.userMenu.open })
      .click({ timeout: 1000 });
    await expect(page.getByRole("menu")).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });
}
