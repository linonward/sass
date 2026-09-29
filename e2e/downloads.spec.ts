import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import messages from "../messages/en.json";
import siteConfig from "../site.config";
import { waitForEmail } from "../src/core/email/testing";
import { signIn, uniqueEmail, useRandomIp, withDatabase } from "./auth-helpers";

// Full flow for selling downloadable files: buy the plan → success page points to the downloads
// page → email → downloads page lists releases → download endpoint.
// Requires SITE_DOWNLOADS=1 (set by the main CI suite) and the fake provider.
test.skip(
  !siteConfig.downloads.enabled || process.env.BILLING_PROVIDER !== "fake",
  "requires SITE_DOWNLOADS=1 and BILLING_PROVIDER=fake",
);

const d = messages.Downloads;
const product = siteConfig.downloads.products[0]!;
const plan = siteConfig.billing.plans.find((p) => p.id === product.planId)!;
const r2Configured = Boolean(
  process.env.R2_ACCOUNT_ID &&
  process.env.R2_ACCESS_KEY_ID &&
  process.env.R2_SECRET_ACCESS_KEY &&
  process.env.R2_BUCKET,
);

test.beforeEach(async ({ page, isMobile }) => {
  test.skip(isMobile, "the purchase flow only runs once, on desktop");
  await useRandomIp(page);
});

test("buy the downloads plan: success page → email → downloads page → download endpoint", async ({
  page,
}) => {
  // Publish a release first (same as pnpm downloads:publish, just without uploading a file).
  const version = `e2e-${randomUUID().slice(0, 8)}`;
  await withDatabase((client) =>
    client.query(
      `insert into download_releases (id, product_id, version, object_key, size)
       values ($1, $2, $3, $4, $5)`,
      [
        randomUUID(),
        product.id,
        version,
        `downloads/${product.id}/${version}/e2e.zip`,
        2048,
      ],
    ),
  );

  const email = uniqueEmail("downloads");
  await signIn(page, email);
  const response = await page.request.post("/api/billing/checkout", {
    data: { planId: plan.id },
  });
  expect(response.ok()).toBe(true);
  await page.goto((await response.json()).url);
  await page.getByRole("button", { name: "Pay" }).click();
  await page.waitForURL(/\/billing\/success\?/);

  // Success page: says the email was sent, and the primary button becomes the downloads page.
  await expect(page.getByText(d.successNote)).toBeVisible({ timeout: 20_000 });
  const mail = await waitForEmail({ to: email, template: "download-ready" });
  expect(mail.html).toMatch(/href="[^"]*\/downloads"/);

  await page.getByRole("link", { name: d.successCta }).click();
  await expect(page).toHaveURL("/downloads");
  const entitlement = page.getByTestId("download-entitlement");
  await expect(entitlement).toHaveCount(1);
  const row = entitlement
    .getByTestId("download-release")
    .filter({ hasText: version });
  await expect(row).toBeVisible();

  // Download endpoint: a signed-in buyer gets a redirect (503 locally / in CI without R2), signed
  // out gets 401.
  const href = await row.getByRole("link").getAttribute("href");
  expect(href).toMatch(/^\/api\/downloads\//);
  const download = await page.request.get(href!, { maxRedirects: 0 });
  expect(download.status()).toBe(r2Configured ? 302 : 503);
  const anonymous = await page.context().browser()!.newContext();
  const unauthenticated = await anonymous.request.get(
    new URL(href!, page.url()).toString(),
    { maxRedirects: 0 },
  );
  expect(unauthenticated.status()).toBe(401);
  await anonymous.close();

  // The releases table isn't tied to a user: delete this row so the downloads page in the local
  // dev database doesn't keep piling up.
  await withDatabase((client) =>
    client.query(
      "delete from download_releases where product_id = $1 and version = $2",
      [product.id, version],
    ),
  );
});

test("never purchased: the downloads page shows the empty state", async ({
  page,
}) => {
  await signIn(page, uniqueEmail("downloads-empty"));
  await page.goto("/downloads");
  await expect(page.getByText(d.empty)).toBeVisible();
  await expect(page.getByTestId("download-entitlement")).toHaveCount(0);
});
