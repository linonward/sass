import { expect, test, type Locator, type Page } from "@playwright/test";

import messages from "../messages/en.json";
import { openUserMenu, signIn, uniqueEmail, useRandomIp } from "./auth-helpers";
import { chooseOption } from "./select-helpers";

// End-to-end flow of the example business module (src/features/invoices/): sign in → create →
// appears in the list → edit → search → delete. Delete this file along with the example.
const inv = messages.Invoices;
const d = messages.Dashboard;

/**
 * Open a dialog and wait for it to appear. Clicks do nothing before hydration finishes, so keep
 * clicking until it really appears (same as openUserMenu in auth-helpers: every action in the loop
 * must be bounded, or one missed click burns the whole budget and leaves no room to retry).
 */
async function openDialog(trigger: Locator, dialog: Locator) {
  await expect(async () => {
    if (!(await dialog.isVisible())) await trigger.click({ timeout: 1000 });
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  return dialog;
}

/** Open the invoices page from the sidebar (on mobile, open the drawer first). */
async function openInvoices(page: Page, isMobile: boolean) {
  if (isMobile) {
    await page.getByRole("button", { name: d.toggleSidebar }).click();
  }
  await page
    .getByRole("list", { name: d.suiteNav })
    .getByRole("link", { name: d.nav.invoices })
    .click();
  await expect(page).toHaveURL("/invoices");
}

/**
 * Go through the create dialog and return the "created" receipt (the list only updates once it's
 * closed).
 */
async function createInvoice(
  page: Page,
  {
    customer,
    amount = "1250.00",
    status = "draft",
  }: {
    customer: string;
    amount?: string;
    status?: keyof typeof inv.form.status;
  },
) {
  const form = await openDialog(
    page.getByTestId("invoice-create"),
    page.getByRole("dialog", { name: inv.create.title }),
  );
  await form.getByLabel(inv.form.customerLabel).fill(customer);
  await form.getByLabel(inv.form.amountLabel).fill(amount);
  await chooseOption(
    form.getByLabel(inv.form.statusLabel),
    inv.form.status[status],
  );
  await form.getByTestId("invoice-create-submit").click();

  const created = page.getByRole("dialog", { name: inv.create.createdTitle });
  await expect(created).toBeVisible();
  return created;
}

/** Search for a term in the search box and wait for the results. */
async function search(page: Page, query: string) {
  await page.getByRole("searchbox", { name: inv.search }).fill(query);
  await page.getByRole("button", { name: inv.searchButton }).click();
  await expect(page).toHaveURL(new RegExp(`/invoices\\?q=${query}`));
}

test.beforeEach(async ({ page }) => {
  await useRandomIp(page);
});

test("signed-out visit to invoices redirects to sign-in, then returns to invoices after sign-in", async ({
  page,
}) => {
  await page.goto("/invoices");
  await expect(page).toHaveURL(/\/sign-in\?callbackURL=%2Finvoices/);
  await signIn(page, uniqueEmail("invoices-callback"));
  await expect(page).toHaveURL("/invoices");
});

test("from the sidebar: create, edit, search, delete", async ({
  page,
  isMobile,
}) => {
  await signIn(page, uniqueEmail("invoices"));
  await openInvoices(page, isMobile);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(inv.title);
  await expect(page.getByText(inv.empty)).toBeVisible();

  // Create: the receipt appearing means success; close it and the new row shows in the list.
  const created = await createInvoice(page, { customer: "Acme Inc." });
  await created.getByRole("button", { name: inv.create.done }).click();

  const row = page.getByTestId("invoice-row");
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId("invoice-row-name")).toHaveText("Acme Inc.");
  await expect(row.getByTestId("invoice-row-status")).toHaveText(
    inv.status.draft,
  );
  await expect(row).toContainText("$1,250.00");

  // Edit: the form is prefilled with current values, and after saving the list shows the new ones.
  const edit = await openDialog(
    row.getByTestId("invoice-edit"),
    page.getByRole("dialog", {
      name: inv.edit.title.replace("{name}", "Acme Inc."),
    }),
  );
  await expect(edit.getByLabel(inv.form.amountLabel)).toHaveValue("1250.00");
  await edit.getByLabel(inv.form.customerLabel).fill("Globex");
  await edit.getByLabel(inv.form.amountLabel).fill("10.50");
  await chooseOption(
    edit.getByLabel(inv.form.statusLabel),
    inv.form.status.paid,
  );
  await edit.getByTestId("invoice-edit-submit").click();
  const saved = page.getByRole("dialog", { name: inv.edit.savedTitle });
  await expect(saved).toBeVisible();
  await saved.getByRole("button", { name: inv.edit.done }).click();

  await expect(row.getByTestId("invoice-row-name")).toHaveText("Globex");
  await expect(row.getByTestId("invoice-row-status")).toHaveText(
    inv.status.paid,
  );
  await expect(row).toContainText("$10.50");

  // Search: a hit leaves just one row, a miss shows an empty-results message (not "no invoices
  // yet").
  const second = await createInvoice(page, {
    customer: "Initech",
    amount: "0.99",
    status: "sent",
  });
  await second.getByRole("button", { name: inv.create.done }).click();
  await expect(row).toHaveCount(2);

  await search(page, "globex");
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId("invoice-row-name")).toHaveText("Globex");

  await search(page, "nobody");
  await expect(row).toHaveCount(0);
  await expect(page.getByText(inv.noResults)).toBeVisible();
  // No matches under a search offers a way back to the full list.
  await page
    .getByRole("link", { name: messages.Common.list.clearFilters })
    .click();
  await expect(page).toHaveURL("/invoices");
  await expect(row).toHaveCount(2);
  await expect(page.getByRole("searchbox", { name: inv.search })).toHaveValue(
    "",
  );

  // Delete: the confirm dialog names the invoice; after confirming the row disappears and the
  // empty message comes back.
  await page.goto("/invoices");
  await expect(row).toHaveCount(2);
  const initech = row.filter({ hasText: "Initech" });
  const confirm = await openDialog(
    initech.getByTestId("invoice-delete"),
    page.getByRole("alertdialog", {
      name: inv.delete.title.replace("{name}", "Initech"),
    }),
  );
  await confirm.getByTestId("invoice-delete-confirm").click();
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId("invoice-row-name")).toHaveText("Globex");

  const last = row.getByTestId("invoice-delete");
  await openDialog(
    last,
    page.getByRole("alertdialog", {
      name: inv.delete.title.replace("{name}", "Globex"),
    }),
  );
  await page.getByTestId("invoice-delete-confirm").click();
  await expect(row).toHaveCount(0);
  await expect(page.getByText(inv.empty)).toBeVisible();
});

// jsdom never ran React's post-action form reset, so the unit test for this
// passed while real browsers cleared the fields. Lock it in a browser.
test("a rejected create keeps what was typed and marks nothing as saved", async ({
  page,
  isMobile,
}) => {
  await signIn(page, uniqueEmail("invoices-invalid"));
  await openInvoices(page, isMobile);
  const form = await openDialog(
    page.getByTestId("invoice-create"),
    page.getByRole("dialog", { name: inv.create.title }),
  );
  await form.getByLabel(inv.form.customerLabel).fill("Keep Me");
  await form.getByLabel(inv.form.amountLabel).fill("abc");
  await chooseOption(
    form.getByLabel(inv.form.statusLabel),
    inv.form.status.sent,
  );
  await form.getByTestId("invoice-create-submit").click();

  await expect(form.getByRole("alert")).toHaveText(inv.errors.invalid);
  await expect(form.getByLabel(inv.form.customerLabel)).toHaveValue("Keep Me");
  await expect(form.getByLabel(inv.form.amountLabel)).toHaveValue("abc");
  await expect(form.getByLabel(inv.form.statusLabel)).toHaveText(
    inv.form.status.sent,
  );
});

test("authorization: other users' invoices can be neither seen nor deleted", async ({
  page,
  isMobile,
}) => {
  await signIn(page, uniqueEmail("invoices-owner"));
  await page.goto("/invoices");
  const created = await createInvoice(page, { customer: "Owner Only Inc." });
  await created.getByRole("button", { name: inv.create.done }).click();
  await expect(page.getByTestId("invoice-row")).toHaveCount(1);

  // Switch accounts: the list is empty, and not even the customer name appears on the page.
  await openUserMenu(page, isMobile);
  await page.getByRole("menuitem", { name: d.userMenu.signOut }).click();
  await expect(page).toHaveURL("/sign-in");
  await signIn(page, uniqueEmail("invoices-other"));
  await page.goto("/invoices");
  await expect(page.getByText(inv.empty)).toBeVisible();
  expect(await page.content()).not.toContain("Owner Only Inc.");
});

// The product UI doesn't overflow horizontally at 375px (light and dark). Table rows have a
// column of action buttons, the most likely to break out, so create an invoice first so it
// renders, then measure.
test.describe("375px width", () => {
  test.use({ viewport: { width: 375, height: 740 } });

  for (const theme of ["light", "dark"] as const) {
    test(`${theme} mode: invoices page doesn't overflow horizontally`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: theme });
      await signIn(page, uniqueEmail(`invoices-overflow-${theme}`));
      await page.goto("/invoices");
      const created = await createInvoice(page, {
        customer: "A customer with a rather long name",
        amount: "999999.99",
        status: "sent",
      });
      await created.getByRole("button", { name: inv.create.done }).click();
      await expect(page.getByTestId("invoice-row")).toHaveCount(1);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
