import { randomUUID } from "node:crypto";

import { expect, test, type Browser, type Page } from "@playwright/test";

import messages from "../messages/en.json";
import { waitForEmail, type StoredEmail } from "../src/core/email/testing";
import {
  clearResendCooldown,
  signIn,
  uniqueEmail,
  useRandomIp,
  withDatabase,
} from "./auth-helpers";
import { chooseOption } from "./select-helpers";
import siteConfig from "../site.config";

const s = messages.Status;
const ad = messages.Admin.statusPage;
const d = messages.Dashboard;

/**
 * Admin emails must be listed in ADMIN_EMAILS (see .github/workflows/ci.yml).
 * One per project, kept separate from admin.spec.ts: when two tests run at once with the same
 * email, `clearResendCooldown` on one side invalidates the code the other side holds (the
 * cooldown is only 60s).
 */
const adminEmail = (project: string) =>
  `e2e-admin-status-${project}@example.com`;

/**
 * Links in emails point at the `site.config.ts` domain (example.com locally, ci.example.test in
 * CI), neither of which is the test server, so only the path is used. The token is in the query
 * string, so search must be kept.
 */
const localLink = (raw: unknown) => {
  const url = new URL(String(raw));
  return url.pathname + url.search;
};

/** The part of a message before its `{date}` placeholder, used to assert "this line exists". */
const labelPrefix = (value: string) => value.split("{date}")[0] ?? value;

const componentLabel = (key: string) => {
  const component = siteConfig.statusPage.components[key];
  if (!component) throw new Error(`no component ${key} in site.config.ts`);
  return component.label;
};

async function newPage(browser: Browser) {
  const page = await (await browser.newContext()).newPage();
  // useRandomIp isn't a React hook; its name just starts with use.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  await useRandomIp(page);
  return page;
}

/**
 * A component's row on `/status`: component rows are the only list items on the page with an h3.
 */
function componentRow(page: Page, label: string) {
  return page
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: label, level: 3 }) });
}

test("visitor opens /status: banner, one row per component, subscribe form at the bottom", async ({
  page,
}) => {
  const response = await page.goto("/status");
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { level: 1, name: s.title }),
  ).toBeVisible();
  await expect(page.getByTestId("status-overall")).toBeVisible();
  for (const component of Object.values(siteConfig.statusPage.components))
    await expect(componentRow(page, component.label)).toBeVisible();
  await expect(page.getByLabel(s.subscribe.label)).toBeVisible();
  await expect(
    page.getByRole("button", { name: s.subscribe.cta }),
  ).toBeVisible();
});

test.describe("375px width", () => {
  test.use({ viewport: { width: 375, height: 740 } });

  for (const theme of ["light", "dark"] as const) {
    test(`${theme} mode: /status doesn't overflow horizontally`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto("/status");
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});

test.describe("incident from creation to recovery", () => {
  // Sign in with the admin email only once (verification codes have a resend cooldown); the
  // tests share this page in order.
  test.describe.configure({ mode: "serial" });

  /** A different description on each run, so assertions never pick up a previous run's incident. */
  const run = randomUUID().slice(0, 8);
  const message = `Elevated latency ${run}`;
  const updated = `Latency worse, investigating ${run}`;
  const email = uniqueEmail("status-sub");

  let admin: Page | undefined;
  let incidentMail: StoredEmail | undefined;

  // Desktop and mobile share one database: tests that write status only run once, on desktop.
  // Otherwise, with both projects in parallel, one side's unresolved incident would fail the other
  // side's "all operational" assertion (intermittent failures in CI). The mobile layout is covered
  // by the test above.
  const desktopOnly =
    "shared database: status changes only run once, on desktop";

  function adminPage() {
    if (!admin) throw new Error("the admin page is only set up on desktop");
    return admin;
  }

  test.beforeAll(async ({ browser }, testInfo) => {
    if (testInfo.project.name !== "desktop") return;
    const page = await newPage(browser);
    const account = adminEmail(testInfo.project.name);
    // A retry after failure signs in again within the cooldown.
    await clearResendCooldown(account);
    await signIn(page, account);
    admin = page;
    // An incident left behind by a previous run that died here would fail "all operational after
    // recovery".
    await withDatabase((db) => db.query("delete from status_events"));
  });

  test.afterAll(async () => {
    await admin?.context().close();
  });

  test("visitor subscribes: confirmation email → click confirm → page shows receipt, admin list shows confirmed", async ({
    browser,
    isMobile,
  }) => {
    test.skip(isMobile, desktopOnly);
    const since = new Date(Date.now() - 1000);
    const page = await newPage(browser);
    await page.goto("/status");
    await page.getByLabel(s.subscribe.label).fill(email);
    await page.getByRole("button", { name: s.subscribe.cta }).click();
    await expect(
      page.getByRole("status").filter({ hasText: s.subscribe.done }),
    ).toBeVisible();

    const mail = await waitForEmail({
      to: email,
      template: "status-subscription",
      since,
    });
    await page.goto(localLink(mail.props.confirmUrl));
    await expect(
      page.getByRole("status").filter({ hasText: s.notice.subscribed }),
    ).toBeVisible();

    const admin = adminPage();
    await admin.goto("/admin/status");
    const row = admin
      .getByRole("row")
      .filter({ has: admin.getByRole("cell", { name: email }) });
    await expect(row).toContainText(ad.subscribers.confirmed);
    await page.close();
  });

  test("admin opens an incident: visitors see degraded, subscribers get notified", async ({
    browser,
    isMobile,
  }) => {
    test.skip(isMobile, desktopOnly);
    const admin = adminPage();
    // The dashboard sidebar only has a single Admin entry; the full admin menu is under /admin.
    await admin.goto("/dashboard");
    await admin
      .getByRole("list", { name: d.adminNav })
      .getByRole("link", { name: d.nav.admin })
      .click();
    await expect(admin).toHaveURL("/admin/users");
    // The admin menu only has this item when the status page is enabled (when off, the page is a
    // 404 and the menu shouldn't keep an entry).
    await admin
      .getByRole("list", { name: d.adminNav })
      .getByRole("link", { name: d.nav.adminStatus })
      .click();
    await expect(admin).toHaveURL("/admin/status");
    await expect(
      admin.getByRole("heading", { level: 1, name: ad.title }),
    ).toBeVisible();

    const since = new Date(Date.now() - 1000);
    await chooseOption(
      admin.getByLabel(ad.create.component),
      componentLabel("api"),
    );
    await chooseOption(
      admin.getByLabel(ad.create.status),
      s.statusLabel.degraded,
    );
    await admin.getByLabel(ad.create.message).fill(message);
    await admin.getByRole("button", { name: ad.create.submit }).click();
    await expect(
      admin.getByRole("status").filter({ hasText: ad.create.created }),
    ).toBeVisible();

    const visitor = await newPage(browser);
    await visitor.goto("/status");
    await expect(visitor.getByTestId("status-overall")).toHaveText(
      s.overall.degraded,
    );
    const row = componentRow(visitor, componentLabel("api"));
    await expect(
      row.getByText(s.statusLabel.degraded, { exact: true }),
    ).toBeVisible();
    await expect(row).toContainText(message);
    await expect(row).toContainText(labelPrefix(s.since));
    // The timeline entry is still ongoing.
    await expect(
      visitor.getByRole("listitem").filter({ hasText: s.ongoing }),
    ).toContainText(message);

    incidentMail = await waitForEmail({
      to: email,
      template: "status-incident",
      since,
    });
    expect(String(incidentMail.props.component)).toBe(componentLabel("api"));
    expect(String(incidentMail.props.message)).toBe(message);
    expect(String(incidentMail.subject)).toContain(componentLabel("api"));
    await visitor.close();
  });

  test("admin changes the impact level: visitors see Major outage and the new description", async ({
    browser,
    isMobile,
  }) => {
    test.skip(isMobile, desktopOnly);
    const admin = adminPage();
    await admin.goto("/admin/status");
    const panel = admin.getByRole("listitem").filter({ hasText: message });
    await chooseOption(panel.getByLabel(ad.open.status), s.statusLabel.outage);
    await panel.getByLabel(ad.open.message).fill(updated);
    await panel.getByRole("button", { name: ad.open.update }).click();
    // After submitting, the row has a new description and the old locator no longer matches, so
    // find it again by the new description.
    await expect(
      admin
        .getByRole("listitem")
        .filter({ hasText: updated })
        .getByRole("status")
        .filter({ hasText: ad.open.updated }),
    ).toBeVisible();

    const visitor = await newPage(browser);
    await visitor.goto("/status");
    await expect(visitor.getByTestId("status-overall")).toHaveText(
      s.overall.outage,
    );
    const row = componentRow(visitor, componentLabel("api"));
    await expect(
      row.getByText(s.statusLabel.outage, { exact: true }),
    ).toBeVisible();
    await expect(row).toContainText(updated);
    await visitor.close();
  });

  test("admin marks resolved: visitors see all operational, and after unsubscribing the admin list no longer has them", async ({
    browser,
    isMobile,
  }) => {
    test.skip(isMobile, desktopOnly);
    const admin = adminPage();
    await admin.goto("/admin/status");
    await admin
      .getByRole("listitem")
      .filter({ hasText: updated })
      .getByRole("button", { name: ad.open.resolve })
      .click();
    // Once resolved it leaves "ongoing" and moves to the history table, with its resolution time.
    await expect(admin.getByText(ad.open.empty)).toBeVisible();
    const history = admin.getByRole("row").filter({ hasText: updated });
    await expect(history).not.toContainText(ad.ongoing);

    const visitor = await newPage(browser);
    await visitor.goto("/status");
    await expect(visitor.getByTestId("status-overall")).toHaveText(
      s.overall.operational,
    );
    const row = componentRow(visitor, componentLabel("api"));
    await expect(
      row.getByText(s.statusLabel.operational, { exact: true }),
    ).toBeVisible();
    await expect(
      visitor.getByRole("listitem").filter({ hasText: s.ongoing }),
    ).toHaveCount(0);
    await expect(
      visitor.getByRole("listitem").filter({ hasText: updated }),
    ).toContainText(labelPrefix(s.resolvedAt));

    if (!incidentMail)
      throw new Error(
        "the notification email wasn't captured in the previous test",
      );
    await visitor.goto(localLink(incidentMail.props.withdrawUrl));
    await expect(
      visitor.getByRole("status").filter({ hasText: s.notice.unsubscribed }),
    ).toBeVisible();
    await admin.goto("/admin/status");
    await expect(admin.getByRole("cell", { name: email })).toHaveCount(0);
    await visitor.close();
  });
});
