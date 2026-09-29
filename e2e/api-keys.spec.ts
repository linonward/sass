import { expect, test, type Page } from "@playwright/test";

import messages from "../messages/en.json";
import {
  findUserId,
  signIn,
  uniqueEmail,
  useRandomIp,
  withDatabase,
} from "./auth-helpers";

const ak = messages.ApiKeys;

/** Fetch the test endpoint's body: `GET /api/api-keys/me` identifies the caller by key. */
async function callWithKey(page: Page, key: string | null) {
  const response = await page.request.get("/api/api-keys/me", {
    headers: key ? { authorization: `Bearer ${key}` } : {},
  });
  return { status: response.status(), body: await response.json() };
}

/**
 * Go through the UI: create a key and read back its one-time plaintext (it's only on the page
 * until the dialog closes).
 */
async function createKey(page: Page, name: string) {
  await page.getByTestId("api-key-create").click();
  const form = page.getByRole("dialog", { name: ak.create.title });
  await form.getByTestId("api-key-name").fill(name);
  await form.getByRole("button", { name: ak.create.submit }).click();

  const created = page.getByRole("dialog", { name: ak.create.createdTitle });
  await expect(created).toBeVisible();
  const plaintext = await created
    .getByTestId("api-key-created-value")
    .inputValue();
  return { created, plaintext };
}

test.beforeEach(async ({ page }) => {
  await useRandomIp(page);
});

test("create key → call the API with it → revoke → the same key is 401 immediately", async ({
  page,
}) => {
  const email = uniqueEmail("api-keys");
  await signIn(page, email);
  await page.goto("/api-keys");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(ak.title);
  await expect(page.getByText(ak.empty)).toBeVisible();

  const name = `Production ${Date.now() % 100000}`;
  const { created, plaintext } = await createKey(page, name);
  // The plaintext is sk_ + 64 hex chars, and appears only this once, in the dialog.
  expect(plaintext).toMatch(/^sk_[0-9a-f]{64}$/);
  await expect(created.getByTestId("api-key-created-name")).toHaveText(
    ak.create.createdName.replace("{name}", name),
  );

  // "Copy" really puts the plaintext on the clipboard (the button only turns into Copied once the
  // write succeeds).
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await created.getByTestId("api-key-copy").click();
  await expect(created.getByTestId("api-key-copy")).toHaveText(
    ak.create.copied,
  );
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    plaintext,
  );
  await created.getByRole("button", { name: ak.create.done }).click();

  // List: prefix only, no plaintext; status is "active".
  const row = page.getByTestId("api-key-row");
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId("api-key-row-name")).toHaveText(name);
  await expect(row.getByTestId("api-key-row-status")).toHaveText(
    ak.status.active,
  );
  await expect(row).toContainText(`${plaintext.slice(0, 11)}…`);
  expect(await page.content()).not.toContain(plaintext);

  // Valid key: the endpoint identifies the caller (request.apiKey).
  const userId = await findUserId(email);
  const ok = await callWithKey(page, plaintext);
  expect(ok.status).toBe(200);
  expect(ok.body).toEqual({
    userId,
    keyId: expect.any(String),
    name,
    prefix: plaintext.slice(0, 11),
  });

  // Recording the last-used time doesn't block the response, but it does eventually reach the
  // database.
  await expect
    .poll(
      () =>
        withDatabase(async (client) => {
          const { rows } = await client.query<{ last_used_at: Date | null }>(
            "select last_used_at from user_api_keys where user_id = $1",
            [userId],
          );
          return rows[0]?.last_used_at ?? null;
        }),
      { timeout: 10_000 },
    )
    .not.toBeNull();
  await page.reload();
  await expect(row).not.toContainText(ak.never);

  // Missing / random string / well-formed but nonexistent → 401.
  expect((await callWithKey(page, null)).status).toBe(401);
  expect(
    (await callWithKey(page, plaintext.split("").reverse().join(""))).status,
  ).toBe(401);
  expect((await callWithKey(page, `sk_${"0".repeat(64)}`)).status).toBe(401);

  // Revoke: the confirm dialog names the key, and after confirming the list status becomes
  // "revoked".
  await row.getByTestId("api-key-revoke").click();
  const confirm = page.getByRole("alertdialog", {
    name: ak.revoke.title.replace("{name}", name),
  });
  await confirm.getByTestId("api-key-revoke-confirm").click();
  await expect(row.getByTestId("api-key-row-status")).toHaveText(
    ak.status.revoked,
  );

  // After revocation the same key stops working immediately (auth hits the database every time;
  // there's no cache window).
  expect((await callWithKey(page, plaintext)).status).toBe(401);

  // After a reload it's still in the list, with no revoke action anymore.
  await page.reload();
  await expect(row.getByTestId("api-key-row-status")).toHaveText(
    ak.status.revoked,
  );
  await expect(row.getByTestId("api-key-revoke")).toHaveCount(0);
});

test("only one key per name: the second attempt reports a duplicate and the list doesn't grow", async ({
  page,
}) => {
  await signIn(page, uniqueEmail("api-keys-duplicate"));
  await page.goto("/api-keys");

  const name = "Shared name";
  const { created } = await createKey(page, name);
  await created.getByRole("button", { name: ak.create.done }).click();
  await expect(page.getByTestId("api-key-row")).toHaveCount(1);

  await page.getByTestId("api-key-create").click();
  const form = page.getByRole("dialog", { name: ak.create.title });
  await form.getByTestId("api-key-name").fill(name);
  await form.getByRole("button", { name: ak.create.submit }).click();
  await expect(form.getByRole("alert")).toHaveText(ak.create.errors.duplicate);
  await form.getByRole("button", { name: ak.create.cancel }).click();

  await expect(page.getByTestId("api-key-row")).toHaveCount(1);
});

// The product UI doesn't overflow horizontally at 375px (light and dark). The table is the
// screen most likely to break out, so create a key first so it renders, then measure.
test.describe("375px width", () => {
  test.use({ viewport: { width: 375, height: 740 } });

  for (const theme of ["light", "dark"] as const) {
    test(`${theme} mode: API keys page doesn't overflow horizontally`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: theme });
      await signIn(page, uniqueEmail(`api-keys-overflow-${theme}`));
      await page.goto("/api-keys");
      const { created } = await createKey(page, "A key with a long-ish name");
      await created.getByRole("button", { name: ak.create.done }).click();
      await expect(page.getByTestId("api-key-row")).toHaveCount(1);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
