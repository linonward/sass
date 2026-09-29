import { expect, test } from "@playwright/test";

import messages from "../messages/en.json";
import {
  findUserId,
  signIn,
  uniqueEmail,
  useRandomIp,
  withDatabase,
} from "./auth-helpers";

const d = messages.Dashboard;
const a = messages.Account;

test.beforeEach(async ({ page }) => {
  await useRandomIp(page);
});

// The product UI used to have no horizontal-overflow coverage (ui-shell's 375px check only
// covers the marketing home page). On narrow screens the sidebar is a drawer, and cards and the
// upload control must all stay contained.
test.describe("375px width", () => {
  test.use({ viewport: { width: 375, height: 740 } });

  for (const theme of ["light", "dark"] as const) {
    test(`${theme} mode: dashboard doesn't overflow horizontally`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: theme });
      await signIn(page, uniqueEmail("overflow"));
      // The first stop after sign-up is onboarding, also part of the product UI: the monospace hints
      // in the checklist are the most likely to push past 375px.
      await expect(page).toHaveURL("/onboarding");
      const onboardingOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(onboardingOverflow, "onboarding").toBeLessThanOrEqual(0);

      await page.goto("/dashboard");
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});

test("sidebar navigates between Dashboard and settings and highlights the current item", async ({
  page,
  isMobile,
}) => {
  await signIn(page, uniqueEmail("nav"));
  // New users land on onboarding first; start testing sidebar navigation from there.
  await expect(page).toHaveURL("/onboarding");
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    d.home.title,
  );

  // On mobile the sidebar is a drawer; open it first.
  if (isMobile) {
    await page.getByRole("button", { name: d.toggleSidebar }).click();
  }
  const main = page.getByRole("list", { name: d.suiteNav });
  await expect(main.getByRole("link", { name: d.nav.home })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await main.getByRole("link", { name: d.nav.settings }).click();

  await expect(page).toHaveURL("/settings");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(a.title);
  if (isMobile) {
    // The drawer closes automatically after clicking a link.
    await expect(main).toBeHidden();
  }
});

test("a changed name persists after reload and shows in the user menu and greeting", async ({
  page,
}) => {
  await signIn(page, uniqueEmail("name"));
  await page.goto("/settings");

  const name = `Ada ${Date.now() % 10000}`;
  const form = page.getByRole("form", { name: a.name.label });
  await form.getByRole("textbox", { name: a.name.label }).fill(name);
  await form.getByRole("button", { name: a.name.save }).click();
  await expect(page.getByRole("status")).toHaveText(a.status.saved);

  await page.reload();
  await expect(page.getByRole("textbox", { name: a.name.label })).toHaveValue(
    name,
  );

  await page.goto("/dashboard");
  await expect(page.getByTestId("signed-in-as")).toHaveText(
    d.home.welcomeName.replace("{name}", name),
  );
});

test("delete account: double confirmation, back to home, data wiped, signing in again gives a new account", async ({
  page,
}) => {
  const email = uniqueEmail("delete");
  await signIn(page, email);
  await expect(page).toHaveURL("/onboarding");
  const oldId = await findUserId(email);
  expect(oldId).toBeTruthy();

  await page.goto("/settings");
  await page.getByRole("button", { name: a.delete.open }).click();
  const dialog = page.getByRole("alertdialog", { name: a.delete.title });
  const confirm = dialog.getByRole("button", { name: a.delete.confirm });

  // Can't submit when the typed email doesn't match.
  await expect(confirm).toBeDisabled();
  await dialog.getByRole("textbox").fill("someone-else@example.com");
  await expect(confirm).toBeDisabled();
  await dialog.getByRole("textbox").fill(email.toUpperCase());
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect(page).toHaveURL("/");

  // The old session is invalidated immediately.
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in\?callbackURL=/);

  // The user and their sessions, accounts, and verification records are all gone from the
  // database.
  const left = await withDatabase(async (client) => {
    const count = async (sql: string, value: string) =>
      Number((await client.query(sql, [value])).rows[0].count);
    return {
      user: await count('select count(*) from "user" where id = $1', oldId!),
      session: await count(
        "select count(*) from session where user_id = $1",
        oldId!,
      ),
      account: await count(
        "select count(*) from account where user_id = $1",
        oldId!,
      ),
      verification: await count(
        "select count(*) from verification where identifier like '%' || $1",
        email,
      ),
    };
  });
  expect(left).toEqual({ user: 0, session: 0, account: 0, verification: 0 });

  // Verification-code sign-in auto-registers: signing in again with the same email gives a new,
  // empty account. This sign-in starts from /sign-in?callbackURL=/dashboard (the previous block
  // just verified the old session is invalid), and sign-ins with a callbackURL respect the deep
  // link, so the new account doesn't land on onboarding first (see onboarding.spec.ts).
  await useRandomIp(page);
  await signIn(page, email);
  await expect(page).toHaveURL("/dashboard");
  const newId = await findUserId(email);
  expect(newId).toBeTruthy();
  expect(newId).not.toBe(oldId);
});
