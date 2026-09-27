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
  // 邀请落地页同样不存在：码的格式是对的，模块关着就只给 404。
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

test("default-off referrals: /referrals 对已登录用户也是 404，且不写任何数据", async ({
  page,
}) => {
  await useRandomIp(page);
  const email = uniqueEmail("referrals-disabled");
  await signIn(page, email);
  const response = await page.goto("/referrals");
  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: messages.Referrals.title }),
  ).toHaveCount(0);
  // 页面没渲染，也就没人给这个账号生成邀请码。
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
