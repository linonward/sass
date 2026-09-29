import { expect, test } from "@playwright/test";

import messages from "../messages/en.json";
import { signIn, uniqueEmail, useRandomIp } from "./auth-helpers";

/**
 * Out-of-the-box state: `userFlags.enabled: false` (see site.config.ts).
 * The enabled behavior is covered by the temporary copy in `e2e/flags/` (that suite runs on a
 * different port).
 */
test("with the master switch off, the dashboard has no flag section and the admin flag list doesn't exist", async ({
  page,
}) => {
  await useRandomIp(page);
  await signIn(page, uniqueEmail("flags-off"));

  // The whole demo section doesn't render — not even a fallback; the page looks the same as
  // without the module.
  await page.goto("/dashboard");
  await expect(page.getByTestId("flag-example")).toHaveCount(0);
  await expect(page.getByTestId("flag-beta-dashboard")).toHaveCount(0);
  await expect(page.getByTestId("flag-beta-dashboard-off")).toHaveCount(0);

  // The admin page is a 404 as well (module off; non-admins can't get in anyway).
  expect((await page.goto("/admin/flags"))?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: messages.Admin.flags.title }),
  ).toHaveCount(0);
});
