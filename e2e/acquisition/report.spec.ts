import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import messages from "../../messages/en.json";
import {
  clearResendCooldown,
  findUserId,
  signIn,
  stubGoogleOneTap,
  uniqueEmail,
  useRandomIp,
  withDatabase,
} from "../auth-helpers";
import { chooseOption } from "../select-helpers";

const ad = messages.Admin;
const d = messages.Dashboard;
const t = ad.acquisition;
const port = Number(process.env.E2E_PORT ?? 3100) + 2;
const outboxDir = path.join(
  os.tmpdir(),
  `sass-acquisition-e2e-${port}`,
  ".tmp/emails",
);

/**
 * Admin emails must be listed in ADMIN_EMAILS (see .github/workflows/ci.yml).
 * One per project, so parallel runs don't trip the same email's verification-code resend
 * cooldown.
 */
const adminEmail = (project: string) => `e2e-admin-${project}@example.com`;

/**
 * Dismiss the attribution banner before signing in. It's fixed to the bottom, and while open it
 * sits right over the sign-in form's button, intercepting clicks (expect().toPass retries don't
 * get past it either).
 */
async function acceptConsent(page: Page) {
  await page
    .getByRole("button", { name: messages.Acquisition.accept, exact: true })
    .click();
}

/** Record the source on a landing page, accept attribution, then sign up a user. */
async function signUpFrom(page: Page, source: string, email: string) {
  await page.goto(`/?utm_source=${source}`);
  await acceptConsent(page);
  await signIn(page, email, { outboxDir });
}

test.describe("channel report", () => {
  // Sign in with the admin email only once (verification codes have a resend cooldown); the
  // tests share this page in order.
  test.describe.configure({ mode: "serial" });

  let admin: Page;
  /** The source signed up by the first test, reused by the filter tests that follow. */
  let source: string;

  test.beforeAll(async ({ browser }, testInfo) => {
    const email = adminEmail(testInfo.project.name);
    // A retry after failure signs in again within the cooldown.
    await clearResendCooldown(email);
    admin = await (await browser.newContext()).newPage();
    await useRandomIp(admin);
    await stubGoogleOneTap(admin);
    await admin.goto("/");
    await acceptConsent(admin);
    await signIn(admin, email, { outboxDir });
  });

  test.afterAll(async () => {
    await admin?.context().close();
  });

  test("the source frozen at sign-up shows in the report, and the menu has an entry", async ({
    browser,
    isMobile,
  }) => {
    source = `e2e-${randomUUID().slice(0, 8)}`;
    const landing = await (await browser.newContext()).newPage();
    await useRandomIp(landing);
    await stubGoogleOneTap(landing);
    await signUpFrom(landing, source, uniqueEmail("report"));
    await landing.context().close();

    // The admin menu only expands under /admin (the dashboard sidebar has a single Admin entry), so
    // land on admin first, then click into the report from the menu.
    await admin.goto("/admin/metrics");
    if (isMobile) {
      await admin.getByRole("button", { name: d.toggleSidebar }).click();
    }
    await admin
      .getByRole("list", { name: d.adminNav })
      .getByRole("link", { name: d.nav.adminAcquisition })
      .click();
    await expect(admin).toHaveURL("/admin/acquisition");
    await expect(
      admin.getByRole("heading", { level: 1, name: t.title }),
    ).toBeVisible();

    // The table is addressed by column only, with no test ids on rows: find the row by the source
    // name in its cell.
    const row = admin
      .getByRole("region", { name: t.channels.title })
      .getByRole("row")
      .filter({ hasText: source });
    await expect(row).toBeVisible();
    await expect(row.getByRole("cell").nth(1)).toHaveText("1");
  });

  test("filter by source; a source with no data shows the empty state", async () => {
    const region = admin.getByRole("region", { name: t.channels.title });

    await admin.goto(`/admin/acquisition?source=${source}`);
    // The filtered result is just this one row, with no made-up conversion rate or acquisition cost
    // at the top.
    await expect(region.getByRole("row")).toHaveCount(2);
    await expect(
      region.getByRole("cell", { name: source, exact: true }),
    ).toBeVisible();
    // Exact match: the page also has the attribution preferences aside (its aria-label also starts
    // with Source).
    await expect(
      admin.getByLabel(ad.acquisition.filters.source, { exact: true }),
    ).toHaveText(source);

    // A well-formed source nobody has used: no error, and it explains why it's empty.
    await admin.goto("/admin/acquisition?source=e2e-never-used");
    await expect(region.getByRole("row")).toHaveCount(2);
    await expect(region.getByText(t.empty)).toBeVisible();
  });

  test("fill filters → click Apply → both URL and table are correct", async ({
    browser,
  }) => {
    const region = admin.getByRole("region", { name: t.channels.title });
    // Sign up another one with a medium, so source and medium among the three selects both have a
    // positive case to check.
    const medium = `e2e-medium-${randomUUID().slice(0, 8)}`;
    const landing = await (await browser.newContext()).newPage();
    await useRandomIp(landing);
    await stubGoogleOneTap(landing);
    await landing.goto(`/?utm_source=${source}&utm_medium=${medium}`);
    await acceptConsent(landing);
    await signIn(landing, uniqueEmail("apply"), { outboxDir });
    await landing.context().close();

    // The same source now has two sign-ups (the first had no medium).
    await admin.goto(`/admin/acquisition?source=${source}`);
    const rows = region.getByRole("row").filter({ hasText: source });
    await expect(rows.getByRole("cell").nth(1)).toHaveText("2");

    // Switch to 7 days (the 30-day default isn't written to the URL) before submitting: range is a
    // hidden field and has to go along with the form.
    await admin
      .getByRole("link", { name: ad.filter.range.days.replace("{days}", "7") })
      .click();
    await expect(admin).toHaveURL(
      `/admin/acquisition?source=${source}&range=7`,
    );
    await chooseOption(
      admin.getByLabel(t.filters.medium, { exact: true }),
      medium,
    );
    await admin.getByRole("button", { name: t.filters.apply }).click();

    // After the GET submit the URL is in canonical form: range and both filters are present, with no
    // empty dead params.
    await expect(admin).toHaveURL(
      `/admin/acquisition?range=7&source=${source}&medium=${medium}`,
    );
    const submitted = new URL(admin.url());
    expect(submitted.searchParams.get("campaign")).toBeNull();

    // The table uses the same filters: medium narrows it down to the sign-up just created.
    await expect(rows.getByRole("cell").nth(1)).toHaveText("1");
    await expect(
      admin.getByLabel(t.filters.source, { exact: true }),
    ).toHaveText(source);
  });

  test("empty params collapse into the canonical URL, and selects follow client-side navigation", async () => {
    // Submitting the form writes empty options as source=&medium=&campaign= (the server treats them
    // as absent); a hand-built URL like that should also land on the version without dead params.
    await admin.goto("/admin/acquisition?source=&medium=&campaign=");
    await expect(admin).toHaveURL("/admin/acquisition");

    // Client-side navigation within the same route (links, back/forward) doesn't remount nodes, so
    // the selects must follow the URL, or the filters shown won't match the filters the table uses.
    await admin.goto(`/admin/acquisition?source=${source}`);
    await admin
      .getByRole("link", { name: ad.filter.range.days.replace("{days}", "7") })
      .click();
    await expect(admin).toHaveURL(
      `/admin/acquisition?source=${source}&range=7`,
    );
    await expect(
      admin.getByLabel(t.filters.source, { exact: true }),
    ).toHaveText(source);

    // Going back to another filter value: both the table and the selects should match the URL.
    await admin.goto("/admin/acquisition?source=e2e-never-used");
    await admin.goBack();
    await expect(admin).toHaveURL(
      `/admin/acquisition?source=${source}&range=7`,
    );
    await expect(
      admin.getByLabel(t.filters.source, { exact: true }),
    ).toHaveText(source);
    await expect(
      admin
        .getByRole("region", { name: t.channels.title })
        .getByRole("cell", { name: source, exact: true }),
    ).toBeVisible();
  });

  test("a bad currency doesn't crash the report, and one currency isn't split across rows", async ({
    browser,
  }) => {
    const moneySource = `e2e-money-${randomUUID().slice(0, 8)}`;
    const email = uniqueEmail("money");
    const landing = await (await browser.newContext()).newPage();
    await useRandomIp(landing);
    await stubGoogleOneTap(landing);
    await signUpFrom(landing, moneySource, email);
    await landing.context().close();

    const userId = await findUserId(email);
    expect(userId).toBeTruthy();
    // Three paid orders: a NULL currency (uses the fallback from config), a lowercase currency, and an
    // invalid four-letter currency. `orders.currency` is a free-text column, and the last one used to
    // make Intl.NumberFormat throw a RangeError and 500 the whole page — whoever filed the ticket
    // couldn't open the report at all until that row was cleaned up.
    await withDatabase(async (client) => {
      const order = (amount: number, currency: string | null) => [
        randomUUID(),
        userId,
        `e2e-order-${randomUUID().slice(0, 8)}`,
        amount,
        currency,
      ];
      for (const values of [
        order(1250, null),
        order(700, "usd"),
        order(100, "USDC"),
      ]) {
        await client.query(
          `insert into orders (id, user_id, provider, provider_order_id, status, amount, currency)
           values ($1, $2, 'e2e', $3, 'paid', $4, $5)`,
          values,
        );
      }
    });

    const response = await admin.goto(
      `/admin/acquisition?source=${moneySource}`,
    );
    expect(response?.status()).toBe(200);
    const row = admin
      .getByRole("region", { name: t.channels.title })
      .getByRole("row")
      .filter({ hasText: moneySource });
    // The fallback currency shows NULL as an amount (not a bare number), merged into one row with the
    // lowercase usd; the invalid currency falls back to "number + raw code" so you can tell which
    // currency is broken.
    await expect(row.getByRole("cell").nth(3)).toHaveText("$19.50 · 1 USDC");
  });

  test("regular users get a 404 on the channel report", async ({ browser }) => {
    const user = await (await browser.newContext()).newPage();
    await useRandomIp(user);
    await stubGoogleOneTap(user);
    await user.goto("/");
    await acceptConsent(user);
    await signIn(user, uniqueEmail("not-admin"), { outboxDir });
    expect((await user.goto("/admin/acquisition"))?.status()).toBe(404);
    await user.context().close();
  });

  // Admin is the most likely place to overflow horizontally: a five-column table and a row of
  // filters. Open a new page in the same context so the session carries over.
  test("channel report doesn't overflow horizontally on narrow screens", async () => {
    const page = await admin.context().newPage();
    await page.setViewportSize({ width: 375, height: 740 });
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto("/admin/acquisition");
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(
        overflow,
        `${theme} mode overflows by ${overflow}px`,
      ).toBeLessThanOrEqual(0);
    }
    await page.close();
  });
});
