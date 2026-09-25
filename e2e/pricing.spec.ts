import { expect, test, type Page } from "@playwright/test";

import messages from "../messages/en.json";
import siteConfig from "../site.config";
import { signIn, uniqueEmail, useRandomIp } from "./auth-helpers";

// 整条购买流程用站内的 fake 服务商模拟（BILLING_PROVIDER=fake，CI 已设置）：
// 结账页是 /api/billing/fake/checkout，"付款"后按设定的延迟把 webhook 推给 /api/webhooks/fake。
test.skip(
  process.env.BILLING_PROVIDER !== "fake",
  "需要 BILLING_PROVIDER=fake",
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
  test.skip(isMobile, "购买流程只在桌面端跑一遍");
  await useRandomIp(page);
});

/** 在模拟结账页上"付款"。 */
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

/** 点击购买按钮：hydration 完成前点击没有反应，重试到页面开始跳转为止。 */
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

test("未登录从落地页购买：登录 → 继续结账 → webhook 延迟 → 成功 → 账单页", async ({
  page,
}) => {
  await page.goto("/");
  await buy(page, "pro");

  // 先去登录，登录后回到 /pricing?plan=pro 并自动继续结账。
  await expect(page).toHaveURL(
    `/sign-in?callbackURL=${encodeURIComponent("/pricing?plan=pro")}`,
  );
  await signIn(page, uniqueEmail("buy-pro"));
  await pay(page, { delay: 3000 });

  // webhook 还没到：显示处理中，页面不报错；到了之后变成成功。
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

  // 已订阅：/pricing 上显示"管理订阅"。
  await page.goto("/pricing");
  await expect(
    planCard(page, "pro").getByRole("link", { name: b.actions.manage }),
  ).toBeVisible();

  // 落地页不区分用户：点购买时接口返回已订阅，转到客户门户。
  await page.goto("/");
  await buy(page, "pro");
  await expect(
    page.getByRole("heading", { name: "Fake customer portal" }),
  ).toBeVisible();
});

test("webhook 迟到超过等待时长：先提示联系支持，到账后自动变成成功", async ({
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

  // 一次性套餐买过之后，/pricing 上显示"已购买"。
  await page.goto("/pricing");
  await expect(
    planCard(page, "lifetime").getByRole("link", { name: b.actions.purchased }),
  ).toBeVisible();
});

test("webhook 一直不到：成功页停在联系支持，不报错", async ({ page }) => {
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

test("免费套餐直接进入 dashboard，未登录时先登录", async ({ page }) => {
  await page.goto("/pricing");
  await planCard(page, "free")
    .getByRole("link", { name: choose("free") })
    .click();
  await expect(page).toHaveURL(
    `/sign-in?callbackURL=${encodeURIComponent("/dashboard")}`,
  );
});

test("fake 结账页拒绝伪造的 token，只能替自己付款", async ({ page }) => {
  const bad = await page.request.get("/api/billing/fake/checkout?token=x.y");
  expect(bad.status()).toBe(400);

  await signIn(page, uniqueEmail("fake-owner"));
  const { url } = await (
    await page.request.post("/api/billing/checkout", {
      data: { planId: "pro" },
    })
  ).json();
  const token = new URL(url, "http://x").searchParams.get("token")!;

  // 换一个用户提交同一个 token：拒绝。
  await page.context().clearCookies();
  await signIn(page, uniqueEmail("fake-intruder"));
  const response = await page.request.post("/api/billing/fake/checkout", {
    form: { token, webhook: "skip" },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(403);
});
