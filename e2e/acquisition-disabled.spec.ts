import { expect, test } from "@playwright/test";
import messages from "../messages/en.json";
import { newReferralCode } from "../src/core/acquisition/referrals/code";
import { signIn, uniqueEmail, useRandomIp, withDatabase } from "./auth-helpers";

test("default-off acquisition has no UI, cookies, API requests or enabled endpoint", async ({
  page,
}) => {
  const requests: string[] = [];
  const scripts: Promise<string>[] = [];
  page.on("response", (response) => {
    if (response.request().resourceType() === "script")
      scripts.push(response.text().catch(() => ""));
  });
  page.on("request", (request) => {
    if (request.url().includes("/api/acquisition"))
      requests.push(request.url());
  });
  await page.goto("/?utm_source=disabled");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(
    page.getByRole("button", { name: messages.Acquisition.preferences }),
  ).toHaveCount(0);
  expect(requests).toEqual([]);
  expect(
    (await Promise.all(scripts)).some((script) =>
      script.includes("acquisition-source-choice"),
    ),
  ).toBe(false);
  expect(
    (await page.context().cookies()).some((c) =>
      c.name.startsWith("acquisition_"),
    ),
  ).toBe(false);
  expect(
    (await page.request.get("/api/acquisition/attribution")).status(),
  ).toBe(404);
  expect(
    (await page.request.post("/api/acquisition/leads", { data: {} })).status(),
  ).toBe(404);
  expect((await page.request.get("/api/acquisition/leads")).status()).toBe(404);
  expect(
    (
      await page.request.post("/api/acquisition/referrals", { data: {} })
    ).status(),
  ).toBe(404);
  // The referral landing page doesn't exist either: the code format is valid, but with the module
  // off it only returns 404.
  expect(
    (await page.request.get(`/invite/${newReferralCode()}`)).status(),
  ).toBe(404);
  for (const route of ["/waitlist", "/waitlist/confirm", "/waitlist/withdraw"])
    expect((await page.request.get(route)).status()).toBe(404);
  await page.goto("/waitlist");
  expect(
    (await Promise.all(scripts)).some((script) =>
      script.includes("/api/acquisition/leads"),
    ),
  ).toBe(false);
});

test("default-off referrals: /referrals is 404 for signed-out and signed-in users and writes no data", async ({
  page,
}) => {
  await useRandomIp(page);
  // Signed out first: with the module off, signed-out visitors must not be sent to sign-in
  // (otherwise the same URL is a 307 when signed out and a 404 when signed in — the page lives
  // under (app), whose layout redirects to sign-in first).
  const anonymous = await page.goto("/referrals");
  expect(anonymous?.status()).toBe(404);
  await expect(page).toHaveURL("/referrals");

  const email = uniqueEmail("referrals-disabled");
  await signIn(page, email);
  const response = await page.goto("/referrals");
  expect(response?.status()).toBe(404);
  await expect(page).toHaveURL("/referrals");
  await expect(
    page.getByRole("heading", { name: messages.Referrals.title }),
  ).toHaveCount(0);
  // The page never rendered, so nothing generated a referral code for this account.
  const codes = await withDatabase(
    async (db) =>
      (
        await db.query<{ count: number }>(
          'select count(*)::int as count from referral_codes c join "user" u on u.id = c.user_id where u.email = $1',
          [email],
        )
      ).rows[0]!.count,
  );
  expect(codes).toBe(0);
});
