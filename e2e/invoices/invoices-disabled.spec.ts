import os from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

import messages from "../../messages/en.json";
import { signIn, uniqueEmail, useRandomIp } from "../auth-helpers";

/**
 * What things look like with `features.examples.invoices` turned off (temporary copy: see
 * e2e/invoices/serve.ts). The enabled behavior is covered by e2e/invoices.spec.ts in the root
 * suite; together the two pin down "clean on both sides of the switch".
 */
const inv = messages.Invoices;
const d = messages.Dashboard;
// The server runs in the temporary copy, so verification codes land in its own .tmp/emails
// (EMAIL_OUTBOX_DIR is relative to the process cwd).
const port = Number(process.env.E2E_PORT ?? 3100) + 4;
const outboxDir = path.join(
  os.tmpdir(),
  `sass-invoices-e2e-${port}`,
  ".tmp/emails",
);

test("when off: no sidebar entry, direct visits 404", async ({
  page,
  isMobile,
}) => {
  await useRandomIp(page);

  // Signed out it's also a 404: the check lives in the proxy (moduleGatedPages in
  // src/core/auth/routes.ts), so there's no detour to sign-in first — the same URL gives the same
  // result for both.
  expect((await page.goto("/invoices"))?.status()).toBe(404);

  await signIn(page, uniqueEmail("invoices-off"), { outboxDir });

  await page.goto("/dashboard");
  if (isMobile)
    await page.getByRole("button", { name: d.toggleSidebar }).click();
  const suite = page.getByRole("list", { name: d.suiteNav });
  // The menu itself renders (other entries in the same group are there), just without this item —
  // turning the switch off shouldn't leave behind an entry that leads to a 404.
  await expect(
    suite.getByRole("link", { name: d.nav.playground }),
  ).toBeVisible();
  await expect(suite.getByRole("link", { name: d.nav.invoices })).toHaveCount(
    0,
  );

  // Signed in, it's still unreachable: a full-page 404, not an empty list.
  expect((await page.goto("/invoices"))?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: inv.title })).toHaveCount(0);
});
