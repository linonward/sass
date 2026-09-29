import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import messages from "../messages/en.json";
import {
  findUserId,
  signIn,
  uniqueEmail,
  useRandomIp,
  withDatabase,
} from "./auth-helpers";

// Example business module (src/features/example/). Delete this file along with the example.
const ex = messages.Example;
const d = messages.Dashboard;

async function grantCredits(userId: string, amount: number) {
  await withDatabase(async (client) => {
    await client.query(
      `insert into credit_transactions (user_id, type, amount, source, source_id)
       values ($1, 'grant', $2, 'e2e', $3)`,
      [userId, amount, randomUUID()],
    );
    await client.query(
      `insert into user_credits (user_id, balance) values ($1, $2)
       on conflict (user_id) do update set balance = user_credits.balance + $2`,
      [userId, amount],
    );
  });
}

test.beforeEach(async ({ page }) => {
  await useRandomIp(page);
});

test("signed-out visit to the example page redirects to sign-in, then returns to it after sign-in", async ({
  page,
}) => {
  await page.goto("/example");
  await expect(page).toHaveURL(/\/sign-in\?callbackURL=%2Fexample/);
  await signIn(page, uniqueEmail("example-callback"));
  await expect(page).toHaveURL("/example");
});

test("open from the sidebar, a quick generation deducts 1 credit; insufficient balance shows a prompt", async ({
  page,
  isMobile,
}) => {
  const email = uniqueEmail("example");
  await signIn(page, email);
  await grantCredits((await findUserId(email))!, 1);

  if (isMobile) {
    await page.getByRole("button", { name: d.toggleSidebar }).click();
  }
  await page
    .getByRole("list", { name: d.businessNav })
    .getByRole("link", { name: d.nav.example })
    .click();
  await expect(page).toHaveURL("/example");
  await expect(page.getByTestId("example-balance")).toHaveText(
    "You have 1 credits.",
  );

  const quick = page.getByRole("button", { name: /^Quick/ });
  await page.getByLabel(ex.productLabel).fill("Acme Invoices");
  await quick.click();
  const results = page.getByRole("list", { name: ex.results });
  await expect(results.getByRole("listitem")).toHaveCount(3);
  await expect(results).toContainText("Acme Invoices, without the busywork.");
  await expect(page.getByTestId("example-balance")).toHaveText(
    "You have 0 credits.",
  );

  await quick.click();
  await expect(page.getByText(ex.errors.insufficient_credits)).toBeVisible();
});
