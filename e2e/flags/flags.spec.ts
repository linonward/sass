import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { expect, test, type Browser, type Page } from "@playwright/test";

import messages from "../../messages/en.json";
import {
  clearResendCooldown,
  findUserId,
  signIn,
  stubGoogleOneTap,
  uniqueEmail,
  // eslint's react-hooks rule treats anything with a use prefix as a React Hook; this isn't one,
  // so alias it to sidestep the rule.
  useRandomIp as randomIp,
} from "../auth-helpers";

const ad = messages.Admin;
const d = messages.Dashboard;
const f = d.flags;
const t = ad.flags;
const port = Number(process.env.E2E_PORT ?? 3100) + 3;
const outboxDir = path.join(
  os.tmpdir(),
  `sass-flags-e2e-${port}`,
  ".tmp/emails",
);

/**
 * Same algorithm as `flagBucket` in src/core/flags/evaluate.ts: the first 8 hex chars of
 * `sha256(userId + flagName)` → [0, 1). Computed independently here to cross-check what the page
 * shows; the algorithm itself is pinned by unit tests.
 */
function bucket(userId: string, flagName: string) {
  const hex = createHash("sha256")
    .update(userId + flagName)
    .digest("hex")
    .slice(0, 8);
  return Number.parseInt(hex, 16) / 0x100000000;
}

/**
 * Admin emails must be listed in ADMIN_EMAILS (see the env in .github/workflows/ci.yml).
 * The project name already includes the suite name (flags-desktop / flags-mobile); one email per
 * project keeps parallel runs from tripping the same email's verification-code resend cooldown.
 */
const adminEmail = (project: string) => `e2e-admin-${project}@example.com`;

/** Open a new page with Google One Tap stubbed out and its own IP. */
async function newPage(browser: Browser) {
  const page = await (await browser.newContext()).newPage();
  await randomIp(page);
  await stubGoogleOneTap(page);
  return page;
}

/** Sign up a new user and return the email and user id (bucketing uses the id, not the email). */
async function signUp(page: Page, tag: string) {
  const email = uniqueEmail(tag);
  await signIn(page, email, { outboxDir });
  const userId = await findUserId(email);
  expect(userId, `user row for ${email}`).toBeTruthy();
  return userId!;
}

test.describe("admin flags", () => {
  // Sign in with the admin email only once (verification codes have a resend cooldown); the
  // tests share this page in order.
  test.describe.configure({ mode: "serial" });

  let admin: Page;

  test.beforeAll(async ({ browser }, testInfo) => {
    const email = adminEmail(testInfo.project.name);
    // A retry after failure signs in again within the cooldown.
    await clearResendCooldown(email);
    admin = await newPage(browser);
    await signIn(admin, email, { outboxDir });
  });

  test.afterAll(async () => {
    await admin?.context().close();
  });

  test("admin sees the gradually rolled-out feature and the admin-only preview; disabled flags don't render", async () => {
    await admin.goto("/dashboard");
    // beta-dashboard is a 50% rollout, but admins aren't bucketed: they always see the new
    // section, never the fallback.
    await expect(admin.getByTestId("flag-beta-dashboard")).toBeVisible();
    await expect(admin.getByTestId("flag-beta-dashboard")).toContainText(
      f.dashboardOn,
    );
    await expect(admin.getByTestId("flag-beta-dashboard-off")).toHaveCount(0);
    // beta-preview is rollout 0 + adminOnly: only admins can see it.
    await expect(admin.getByTestId("flag-beta-preview")).toBeVisible();
    // beta-soon is enabled: false in config: false for everyone, so the page shows the "not on"
    // copy.
    await expect(admin.getByTestId("flag-beta-soon")).toHaveAttribute(
      "data-state",
      "off",
    );
    await expect(admin.getByTestId("flag-beta-soon")).toHaveText(f.soonOff);
  });

  test("admin /admin/flags lists all definitions and has a menu entry", async ({
    isMobile,
  }) => {
    // The admin menu only expands under /admin (the dashboard sidebar has a single Admin entry).
    await admin.goto("/admin/metrics");
    if (isMobile) {
      await admin.getByRole("button", { name: d.toggleSidebar }).click();
    }
    await admin
      .getByRole("list", { name: d.adminNav })
      .getByRole("link", { name: d.nav.adminFlags })
      .click();
    await expect(admin).toHaveURL("/admin/flags");
    await expect(
      admin.getByRole("heading", { level: 1, name: t.title }),
    ).toBeVisible();

    // The table is addressed by column only, with no test ids on rows: find the row by flag name,
    // then read values by column index.
    const table = admin.getByRole("region", { name: t.list.title });
    const row = (name: string) =>
      table.getByRole("row").filter({ hasText: name });
    const cell = (name: string, column: number) =>
      row(name).getByRole("cell").nth(column);

    await expect(row("beta-dashboard")).toBeVisible();
    await expect(cell("beta-dashboard", 2)).toHaveText(t.status.on);
    await expect(cell("beta-dashboard", 3)).toHaveText(
      t.rollout.replace("{percent}", "50"),
    );
    await expect(cell("beta-dashboard", 4)).toHaveText(t.access.everyone);

    await expect(cell("beta-preview", 3)).toHaveText(
      t.rollout.replace("{percent}", "0"),
    );
    await expect(cell("beta-preview", 4)).toHaveText(t.access.admins);

    await expect(cell("beta-soon", 2)).toHaveText(t.status.off);
    // The page states clearly why it's read-only.
    await expect(admin.getByText(t.configHint)).toBeVisible();
  });

  // Admin is the most likely place to overflow horizontally: a five-column table. Open a new page
  // in the same context so the session carries over.
  test("flag list doesn't overflow horizontally on narrow screens", async () => {
    const page = await admin.context().newPage();
    await page.setViewportSize({ width: 375, height: 740 });
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto("/admin/flags");
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

test("regular users are bucketed by rollout: those in the bucket see the new layout, others see the fallback", async ({
  browser,
}) => {
  // Compute the expected value for each user separately: bucketing is deterministic, so the
  // assertion doesn't depend on luck. Whether both sides got sampled is only recorded (as an
  // annotation), not asserted — bucket uniformity is covered by unit tests.
  const sampled: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    const page = await newPage(browser);
    const userId = await signUp(page, "rollout");
    await page.goto("/dashboard");

    const inRollout = bucket(userId, "beta-dashboard") < 0.5;
    sampled.push(inRollout ? "in" : "out");
    await expect(
      page.getByTestId("flag-beta-dashboard"),
      `user ${userId} (bucket ${bucket(userId, "beta-dashboard")})`,
    ).toHaveCount(inRollout ? 1 : 0);
    await expect(page.getByTestId("flag-beta-dashboard-off")).toHaveCount(
      inRollout ? 0 : 1,
    );
    // rollout 0 + adminOnly: regular users never see it.
    await expect(page.getByTestId("flag-beta-preview")).toHaveCount(0);
    // A flag with enabled: false is false for everyone.
    await expect(page.getByTestId("flag-beta-soon")).toHaveAttribute(
      "data-state",
      "off",
    );
    // Rendering the same page again (reload) gives the same result.
    await page.reload();
    await expect(page.getByTestId("flag-beta-dashboard")).toHaveCount(
      inRollout ? 1 : 0,
    );
    await page.context().close();
  }
  test.info().annotations.push({
    type: "rollout",
    description: `buckets for 4 regular users: ${sampled.join(", ")}`,
  });
});

test("non-admins get a 404 on the admin flag list", async ({ browser }) => {
  const page = await newPage(browser);
  await signIn(page, uniqueEmail("not-admin"), { outboxDir });
  expect((await page.goto("/admin/flags"))?.status()).toBe(404);
  await page.context().close();
});
