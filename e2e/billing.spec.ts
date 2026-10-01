import { expect, test } from "@playwright/test";

import { signIn, uniqueEmail, useRandomIp } from "./auth-helpers";

// CI has no Waffo Pancake credentials (the shipped default provider), so this only checks the
// endpoints' auth and "not configured" behavior — no real payments. If Waffo is configured locally
// in .env.local, it checks signature verification and rejection of placeholder product IDs instead.
const configured = Boolean(
  process.env.WAFFO_MERCHANT_ID && process.env.WAFFO_PRIVATE_KEY,
);
// CI runs the full checkout flow with the fake provider (see pricing.spec.ts); the Waffo routes
// then count as not configured.
const fake = process.env.BILLING_PROVIDER === "fake";

test.beforeEach(async ({ page }) => {
  await useRandomIp(page);
});

test("checkout and customer portal return 401 when signed out", async ({
  request,
}) => {
  const checkout = await request.post("/api/billing/checkout", {
    data: { planId: "pro" },
  });
  expect(checkout.status()).toBe(401);

  const portal = await request.get("/api/billing/portal", {
    maxRedirects: 0,
  });
  expect(portal.status()).toBe(401);
});

test("webhook rejects unsigned requests", async ({ request }) => {
  const response = await request.post("/api/webhooks/waffo", {
    data: { eventType: "PAYMENT_NOTIFICATION", result: {} },
  });
  if (configured && !fake) {
    expect(response.status()).toBe(401);
  } else {
    expect(response.status()).toBe(503);
    expect(await response.json()).toEqual({ error: "billing_not_configured" });
  }
});

test("webhook route of an inactive provider (Creem) returns 503 and doesn't claim another provider's events", async ({
  request,
}) => {
  const response = await request.post("/api/webhooks/creem", {
    data: { id: "evt_x", eventType: "checkout.completed", object: {} },
  });
  expect(response.status()).toBe(503);
  expect(await response.json()).toEqual({ error: "billing_not_configured" });
});

test("signed-in checkout: fake mode returns the on-site checkout page, 503 when Waffo isn't configured", async ({
  page,
}) => {
  await signIn(page, uniqueEmail("checkout"));
  const response = await page.request.post("/api/billing/checkout", {
    data: { planId: "pro" },
  });
  if (fake) {
    expect(response.status()).toBe(200);
    expect((await response.json()).url).toMatch(
      /^\/api\/billing\/fake\/checkout\?token=/,
    );
  } else if (configured) {
    expect(response.ok()).toBe(true);
  } else {
    expect(response.status()).toBe(503);
    expect(await response.json()).toEqual({ error: "billing_not_configured" });
  }
});
