import { expect, test, type Page } from "@playwright/test";

import messages from "../messages/en.json";
import siteConfig from "../site.config";
import { signIn, uniqueEmail, useRandomIp } from "./auth-helpers";

// The whole purchase flow is simulated with the on-site fake provider (BILLING_PROVIDER=fake, set
// in CI): the checkout page is /api/billing/fake/checkout, and after "paying" it pushes the
// webhook to /api/webhooks/fake after the configured delay.
test.skip(
  process.env.BILLING_PROVIDER !== "fake",
  "requires BILLING_PROVIDER=fake",
);

const b = messages.Billing;
const pricing = messages.Landing.pricing;
const timeoutMs = Number(process.env.BILLING_SUCCESS_TIMEOUT_MS ?? 60_000);
const planName = (id: "free" | "pro" | "lifetime") => pricing.plans[id].name;
const choose = (id: "free" | "pro" | "lifetime") =>
  pricing.cta.replace("{plan}", planName(id));
const credits = (id: "pro" | "lifetime") =>
  siteConfig.billing.plans.find((p) => p.id === id)!.credits;

test.beforeEach(async ({ page, isMobile }) => {
  test.skip(isMobile, "the purchase flow only runs once, on desktop");
  await useRandomIp(page);
});

/** "Pay" on the simulated checkout page. */
async function pay(
  page: Page,
  { delay = 0, webhook = true }: { delay?: number; webhook?: boolean } = {},
) {
  await expect(
    page.getByRole("heading", { name: "Fake checkout" }),
  ).toBeVisible();
  await page.getByLabel("Webhook delay (ms)").fill(String(delay));
  if (!webhook) await page.getByLabel("Don't send webhook").check();
  await page.getByRole("button", { name: "Pay" }).click();
  await page.waitForURL(/\/billing\/success\?/);
}

/**
 * Click the buy button: clicks do nothing before hydration finishes, so retry until the page
 * starts navigating.
 */
async function buy(page: Page, id: "pro" | "lifetime") {
  const from = page.url();
  const button = planCard(page, id).getByRole("button", { name: choose(id) });
  await expect(async () => {
    await button.click({ timeout: 2000 });
    await expect(page).not.toHaveURL(from, { timeout: 2000 });
  }).toPass({ timeout: 15_000 });
}

function planCard(page: Page, id: string) {
  return page.locator(`[data-plan="${id}"]`);
}

test("signed-out purchase from pricing: sign in → continue checkout → delayed webhook → success → billing page", async ({
  page,
}) => {
  await page.goto("/pricing");
  await buy(page, "pro");

  // Sign in first; afterwards it returns to /pricing?plan=pro and continues checkout
  // automatically.
  await expect(page).toHaveURL(
    `/sign-in?callbackURL=${encodeURIComponent("/pricing?plan=pro")}`,
  );
  await signIn(page, uniqueEmail("buy-pro"));
  await pay(page, { delay: 3000 });

  // Webhook not here yet: shows processing without erroring; once it arrives it becomes success.
  await expect(
    page.getByRole("heading", { name: b.success.processingTitle }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: b.success.completeTitle }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByText(
      b.success.completeDescription.replace("{plan}", planName("pro")),
    ),
  ).toBeVisible();
  const balance = credits("pro").toLocaleString("en-US");
  await expect(page.getByText(balance, { exact: false })).toBeVisible();

  await page.getByRole("link", { name: b.success.toBilling }).click();
  await expect(page.getByTestId("current-plan")).toHaveText(
    `${planName("pro")} · ${b.page.status.active}`,
  );
  await expect(page.getByTestId("credit-balance")).toHaveText(
    `${balance} credits`,
  );
  await expect(
    page.getByTestId("credit-transactions").getByRole("listitem"),
  ).toHaveCount(1);
  await expect(page.getByRole("link", { name: b.page.manage })).toBeVisible();

  // Subscribed: /pricing shows "Manage subscription".
  await page.goto("/pricing");
  await expect(
    planCard(page, "pro").getByRole("link", { name: b.actions.manage }),
  ).toBeVisible();

  // Subscribed users reach the customer portal through the manage link on the pricing page.
  await planCard(page, "pro")
    .getByRole("link", { name: b.actions.manage })
    .click();
  await expect(
    page.getByRole("heading", { name: "Fake customer portal" }),
  ).toBeVisible();
});

test("webhook later than the wait window: first suggests contacting support, then turns into success once it lands", async ({
  page,
}) => {
  await signIn(page, uniqueEmail("late-webhook"));
  await page.goto("/pricing");
  await buy(page, "lifetime");
  await pay(page, { delay: timeoutMs + 3000 });

  await expect(
    page.getByRole("heading", { name: b.success.timeoutTitle }),
  ).toBeVisible({ timeout: timeoutMs + 5000 });
  await expect(
    page.getByRole("link", { name: siteConfig.legal.contactEmail }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: b.success.completeTitle }),
  ).toBeVisible({ timeout: 20_000 });

  // After buying a one-time plan, /pricing shows "Purchased".
  await page.goto("/pricing");
  await expect(
    planCard(page, "lifetime").getByRole("link", { name: b.actions.purchased }),
  ).toBeVisible();

  // A one-time purchase creates no subscription, but the billing page must not say "free plan".
  await page.goto("/billing");
  await expect(page.getByText(b.page.purchasedOnly)).toBeVisible();
  await expect(page.getByText(b.page.freePlan)).toHaveCount(0);
});

test("webhook never arrives: success page stays on contact support without erroring", async ({
  page,
}) => {
  await signIn(page, uniqueEmail("no-webhook"));
  await page.goto("/pricing");
  await buy(page, "lifetime");
  await pay(page, { webhook: false });

  await expect(
    page.getByRole("heading", { name: b.success.processingTitle }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: b.success.timeoutTitle }),
  ).toBeVisible({ timeout: timeoutMs + 5000 });
  await expect(
    page.getByRole("heading", { name: b.success.completeTitle }),
  ).toHaveCount(0);
});

test("free plan goes straight to the dashboard, signing in first when signed out", async ({
  page,
}) => {
  await page.goto("/pricing");
  await planCard(page, "free")
    .getByRole("link", { name: choose("free") })
    .click();
  await expect(page).toHaveURL(
    `/sign-in?callbackURL=${encodeURIComponent("/dashboard")}`,
  );
});

test("fake checkout page rejects forged tokens; you can only pay for yourself", async ({
  page,
}) => {
  const bad = await page.request.get("/api/billing/fake/checkout?token=x.y");
  expect(bad.status()).toBe(400);

  await signIn(page, uniqueEmail("fake-owner"));
  const { url } = await (
    await page.request.post("/api/billing/checkout", {
      data: { planId: "pro" },
    })
  ).json();
  const token = new URL(url, "http://x").searchParams.get("token")!;

  // A different user submitting the same token: rejected.
  await page.context().clearCookies();
  await signIn(page, uniqueEmail("fake-intruder"));
  const response = await page.request.post("/api/billing/fake/checkout", {
    form: { token, webhook: "skip" },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(403);
});
