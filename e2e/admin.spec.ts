import { randomUUID } from "node:crypto";

import { expect, test, type Browser } from "@playwright/test";

import messages from "../messages/en.json";
import {
  clearResendCooldown,
  enterCode,
  findUserId,
  requestCode,
  signIn,
  uniqueEmail,
  useRandomIp,
  withDatabase,
} from "./auth-helpers";

const ad = messages.Admin;
const ak = messages.ApiKeys;
const d = messages.Dashboard;

/**
 * Admin emails must be listed in ADMIN_EMAILS (see .github/workflows/ci.yml).
 * One per project, so parallel runs don't trip the same email's verification-code resend
 * cooldown.
 */
const adminEmail = (project: string) => `e2e-admin-${project}@example.com`;

async function newSignedInPage(browser: Browser, email: string) {
  const page = await (await browser.newContext()).newPage();
  // useRandomIp isn't a React hook; its name just starts with use.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  await useRandomIp(page);
  await signIn(page, email);
  return page;
}

test("signed-out visit to /admin returns 404 without redirecting to sign-in", async ({
  page,
}) => {
  for (const path of [
    "/admin",
    "/admin/users",
    "/admin/orders",
    "/admin/exceptions",
    "/admin/metrics",
    "/admin/acquisition",
    "/admin/api-keys",
    "/admin/status",
  ]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
    await expect(page).toHaveURL(path);
  }
});

test("regular users get a 404 on admin and have no admin entry in the sidebar", async ({
  page,
  isMobile,
}) => {
  await useRandomIp(page);
  const email = uniqueEmail("not-admin");
  await signIn(page, email);
  const userId = await findUserId(email);

  for (const path of [
    "/admin",
    "/admin/users",
    `/admin/users/${userId}`,
    "/admin/orders",
    "/admin/exceptions",
    "/admin/subscriptions",
    "/admin/metrics",
    "/admin/acquisition",
    "/admin/api-keys",
    "/admin/status",
  ]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
  }

  await page.goto("/dashboard");
  if (isMobile) {
    await page.getByRole("button", { name: d.toggleSidebar }).click();
  }
  await expect(page.getByRole("list", { name: d.suiteNav })).toBeVisible();
  await expect(page.getByRole("list", { name: d.adminNav })).toHaveCount(0);
});

test.describe("admin", () => {
  // Sign in with the admin email only once (verification codes have a resend cooldown); the
  // tests share this page in order.
  test.describe.configure({ mode: "serial" });

  let admin: Awaited<ReturnType<typeof newSignedInPage>>;
  let email: string;

  test.beforeAll(async ({ browser }, testInfo) => {
    email = adminEmail(testInfo.project.name);
    // A retry after failure signs in again within the cooldown.
    await clearResendCooldown(email);
    admin = await newSignedInPage(browser, email);
  });

  test.afterAll(async () => {
    await admin?.context().close();
  });

  test("an email in ADMIN_EMAILS gets the admin role on sign-in and an admin entry in the dashboard", async ({
    isMobile,
  }) => {
    await admin.goto("/dashboard");
    if (isMobile) {
      await admin.getByRole("button", { name: d.toggleSidebar }).click();
    }
    await admin
      .getByRole("list", { name: d.adminNav })
      .getByRole("link", { name: d.nav.admin })
      .click();
    await expect(admin).toHaveURL("/admin/users");
    await expect(
      admin.getByRole("heading", { level: 1, name: ad.users.title }),
    ).toBeVisible();
  });

  test("search a user, adjust credits: balance and credit transactions are correct and show the acting admin", async ({
    browser,
  }) => {
    const targetEmail = uniqueEmail("adjust");
    const target = await newSignedInPage(browser, targetEmail);
    await target.context().close();

    await admin.goto("/admin/users");
    await admin
      .getByRole("searchbox", { name: ad.users.search })
      .fill(targetEmail);
    await admin.getByRole("button", { name: ad.users.searchButton }).click();
    await expect(admin).toHaveURL(/\/admin\/users\?q=/);
    await admin.getByRole("link", { name: targetEmail }).click();
    await expect(
      admin.getByRole("heading", { level: 1, name: targetEmail }),
    ).toBeVisible();

    const form = admin.getByRole("form", { name: ad.user.adjust });
    await form.getByLabel(ad.user.amount).fill("25");
    await form.getByLabel(ad.user.reason, { exact: true }).fill("e2e bonus");
    await form.getByRole("button", { name: ad.user.adjust }).click();
    await expect(form.getByRole("status")).toHaveText(ad.user.adjusted);
    await expect(admin.getByTestId("admin-credit-balance")).toHaveText(
      "25 credits",
    );
    const entry = admin
      .getByTestId("admin-credit-transactions")
      .getByRole("listitem")
      .first();
    await expect(entry).toContainText("e2e bonus");
    await expect(entry).toContainText(`by ${email}`);
    await expect(entry).toContainText("+25");

    // Deducting below zero is rejected and the balance is unchanged.
    await form.getByLabel(ad.user.amount).fill("-100");
    await form.getByLabel(ad.user.reason, { exact: true }).fill("too much");
    await form.getByRole("button", { name: ad.user.adjust }).click();
    await expect(form.getByRole("alert")).toHaveText(ad.errors.insufficient);
    await expect(admin.getByTestId("admin-credit-balance")).toHaveText(
      "25 credits",
    );
  });

  test("a banned user is signed out and can't sign in again; unbanning restores access", async ({
    browser,
  }) => {
    const targetEmail = uniqueEmail("ban");
    const target = await newSignedInPage(browser, targetEmail);
    const userId = await findUserId(targetEmail);

    await admin.goto(`/admin/users/${userId}`);
    const ban = admin.getByRole("form", { name: ad.user.ban });
    await ban.getByLabel(ad.user.banReason).fill("spam");
    await ban.getByRole("button", { name: ad.user.ban }).click();
    await expect(admin.getByText(ad.user.bannedNotice)).toBeVisible();

    // Existing sessions are invalidated: a reload goes back to sign-in.
    await target.reload();
    await expect(target).toHaveURL(/\/sign-in/);
    // Signing in again is rejected.
    await clearResendCooldown(targetEmail);
    const { code } = await requestCode(target, targetEmail);
    await enterCode(target, code);
    await expect(target.getByTestId("auth-error")).toHaveText(
      messages.Auth.errors.banned,
    );

    await admin
      .getByRole("form", { name: ad.user.unban })
      .getByRole("button", { name: ad.user.unban })
      .click();
    await expect(admin.getByText(ad.user.banDescription)).toBeVisible();
    await target.context().close();
  });

  test("metrics page shows sign-ups and revenue and can switch time ranges", async ({
    isMobile,
  }) => {
    await admin.goto("/admin/users");
    if (isMobile) {
      await admin.getByRole("button", { name: d.toggleSidebar }).click();
    }
    await admin
      .getByRole("list", { name: d.adminNav })
      .getByRole("link", { name: d.nav.adminMetrics })
      .click();
    await expect(admin).toHaveURL("/admin/metrics");
    await expect(
      admin.getByRole("heading", { level: 1, name: ad.metrics.title }),
    ).toBeVisible();
    // This test's admin signed up today, so new sign-ups are at least 1.
    await expect(admin.getByTestId("metric-new-users")).not.toContainText(
      /^\D*0$/,
    );
    await expect(
      admin.getByRole("region", { name: ad.metrics.revenue.title }),
    ).toBeVisible();

    const range = admin.getByRole("navigation", {
      name: ad.filter.range.label,
    });
    await range.getByRole("link", { name: "7 days" }).click();
    await expect(admin).toHaveURL("/admin/metrics?range=7");
    await expect(range.getByRole("link", { name: "7 days" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  // The channel report only exists when attribution is on (see e2e/acquisition/report.spec.ts).
  // The template ships with it off, so even admins should get a 404, and the menu shouldn't show
  // an entry that leads to a 404.
  test("with attribution off, the channel report is 404 and has no admin menu entry", async ({
    isMobile,
  }) => {
    expect((await admin.goto("/admin/acquisition"))?.status()).toBe(404);
    await admin.goto("/admin/metrics");
    if (isMobile) {
      await admin.getByRole("button", { name: d.toggleSidebar }).click();
    }
    // Seven items: metrics / status page / users / API keys / orders / exceptions / subscriptions (the
    // status page and API keys are enabled by statusPage.enabled and apiKeys.enabled in
    // site.config.ts; the attribution entry isn't among the seven).
    const nav = admin.getByRole("list", { name: d.adminNav });
    await expect(nav.getByRole("link")).toHaveCount(7);
    await expect(
      nav.getByRole("link", { name: d.nav.adminStatus }),
    ).toHaveAttribute("href", "/admin/status");
    await expect(
      nav.getByRole("link", { name: d.nav.adminApiKeys }),
    ).toHaveAttribute("href", "/admin/api-keys");
    await expect(
      admin.getByRole("link", { name: d.nav.adminAcquisition }),
    ).toHaveCount(0);
  });

  // Admin only sees counts and times: neither the plaintext (not even in the database) nor the
  // hash should appear on the page.
  test("admin API keys page shows counts and last-used time, without plaintext", async ({
    browser,
    isMobile,
  }) => {
    const ownerEmail = uniqueEmail("api-keys-owner");
    const owner = await newSignedInPage(browser, ownerEmail);
    await owner.goto("/api-keys");
    await owner.getByTestId("api-key-create").click();
    const form = owner.getByRole("dialog", { name: ak.create.title });
    await form.getByTestId("api-key-name").fill("Admin view");
    await form.getByRole("button", { name: ak.create.submit }).click();
    const plaintext = await owner
      .getByTestId("api-key-created-value")
      .inputValue();
    await owner.getByRole("button", { name: ak.create.done }).click();
    // Use it once so "last used" has a value (it's recorded after the response, so wait for it to
    // hit the database).
    await owner.request.get("/api/api-keys/me", {
      headers: { authorization: `Bearer ${plaintext}` },
    });
    const ownerId = await findUserId(ownerEmail);
    await expect
      .poll(
        () =>
          withDatabase(async (client) => {
            const { rows } = await client.query<{ last_used_at: Date | null }>(
              "select last_used_at from user_api_keys where user_id = $1",
              [ownerId],
            );
            return rows[0]?.last_used_at ?? null;
          }),
        { timeout: 10_000 },
      )
      .not.toBeNull();
    await owner.context().close();

    await admin.goto("/admin/metrics");
    if (isMobile) {
      await admin.getByRole("button", { name: d.toggleSidebar }).click();
    }
    await admin
      .getByRole("list", { name: d.adminNav })
      .getByRole("link", { name: d.nav.adminApiKeys })
      .click();
    await expect(admin).toHaveURL("/admin/api-keys");
    await expect(
      admin.getByRole("heading", { level: 1, name: ad.apiKeys.title }),
    ).toBeVisible();

    const row = admin
      .getByTestId("admin-api-key-owner")
      .filter({ hasText: ownerEmail });
    await expect(row.locator("td").nth(1)).toHaveText("1");
    await expect(row.locator("td").nth(2)).toHaveText("1");
    await expect(row.locator("td").nth(3)).not.toHaveText(ad.apiKeys.never);
    expect(await admin.content()).not.toContain(plaintext);
  });

  // Horizontal overflow in the product UI used to be tested only on the marketing home page
  // (ui-shell). Admin is the most likely place to overflow: a six-column table, a 30-bar chart, a
  // row of filters. Open a new page in the same context so the session carries over.
  test("metrics page doesn't overflow horizontally on narrow screens", async () => {
    const page = await admin.context().newPage();
    await page.setViewportSize({ width: 375, height: 740 });
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto("/admin/metrics");
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

  test("exceptions page: open items show a count; resolving with a reason closes the item and keeps the history in the row", async ({}, testInfo) => {
    const ex = ad.exceptions;
    // One user, one shortfall item (balance too low, refunded credits not reclaimed). Written
    // straight to the database: the real path that opens items is covered with a real database and
    // webhooks in src/core/exceptions/exceptions.test.ts.
    const ownerEmail = uniqueEmail(`exceptions-${testInfo.project.name}`);
    const exceptionId = await withDatabase(async (client) => {
      const ownerId = `e2e-exceptions-${randomUUID()}`;
      await client.query(
        `insert into "user" (id, name, email, email_verified, created_at, updated_at)
         values ($1, 'Exceptions', $2, true, now(), now())`,
        [ownerId, ownerEmail],
      );
      const { rows } = await client.query<{ id: string }>(
        `insert into billing_exceptions (kind, user_id, source, source_id, detail)
         values ('refund_reclaim_shortfall', $1, 'billing-refund', $2, $3)
         returning id`,
        [
          ownerId,
          `e2e:order:${randomUUID()}:refund:r1`,
          JSON.stringify({
            orderId: "ord_e2e",
            owed: 2000,
            reclaimed: 500,
            shortfall: 1500,
          }),
        ],
      );
      return rows[0]!.id;
    });

    await admin.goto("/admin/exceptions?status=open");
    await expect(
      admin.getByRole("heading", { name: ex.title, level: 1 }),
    ).toBeVisible();
    // The count in the sidebar (other tests may have open items too, so only assert there's a
    // number).
    if (!testInfo.project.name.includes("mobile")) {
      await expect(admin.getByTestId("nav-badge-adminExceptions")).toHaveText(
        /^[1-9]\d*$/,
      );
    }

    const row = admin.locator(`[data-exception-id="${exceptionId}"]`);
    await expect(row).toContainText(ownerEmail);
    await expect(row).toContainText("ord_e2e");
    await expect(row).toContainText("1500");
    await expect(row).toContainText(ex.statuses.open);

    await row.getByTestId("exception-handle").click();
    const dialog = admin.getByRole("dialog", { name: ex.dialog.title });
    await dialog
      .getByLabel(ex.dialog.reasonLabel)
      .fill("Customer disputed the charge; written off");
    await dialog.getByTestId("exception-action-ignore").click();
    await expect(dialog.getByTestId("exception-result")).toContainText(
      "ignored",
    );
    await dialog.getByRole("button", { name: messages.Common.close }).click();

    await admin.goto("/admin/exceptions?status=ignored");
    const closed = admin.locator(`[data-exception-id="${exceptionId}"]`);
    await expect(closed).toContainText(ex.statuses.ignored);
    await expect(closed.getByTestId("exception-handle")).toHaveCount(0);
    const history = closed.getByTestId("exception-history");
    await history.locator("summary").click();
    await expect(history).toContainText(
      "Customer disputed the charge; written off",
    );
    await expect(history).toContainText(ex.actions.ignore);
    await expect(history).toContainText(adminEmail(testInfo.project.name));
  });

  test("exceptions page doesn't overflow horizontally on narrow screens", async () => {
    const page = await admin.context().newPage();
    await page.setViewportSize({ width: 375, height: 740 });
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto("/admin/exceptions");
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

  test("order and subscription lists can be filtered by status", async () => {
    for (const [path, label] of [
      ["/admin/orders", ad.orderStatus.paid],
      ["/admin/subscriptions", messages.Billing.page.status.active],
    ] as const) {
      await admin.goto(path);
      const filter = admin.getByRole("navigation", {
        name: messages.Common.list.filterLabel,
      });
      await expect(
        filter.getByRole("link", {
          name: messages.Common.list.all,
          exact: true,
        }),
      ).toHaveAttribute("aria-current", "page");
      await filter.getByRole("link", { name: label, exact: true }).click();
      await expect(admin).toHaveURL(new RegExp(`${path}\\?status=`));
      await expect(
        filter.getByRole("link", { name: label, exact: true }),
      ).toHaveAttribute("aria-current", "page");
    }
  });
});
