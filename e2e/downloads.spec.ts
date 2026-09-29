import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import messages from "../messages/en.json";
import siteConfig from "../site.config";
import { waitForEmail } from "../src/core/email/testing";
import { signIn, uniqueEmail, useRandomIp, withDatabase } from "./auth-helpers";

// 卖可下载文件的完整流程：买对应套餐 → 成功页指向下载页 → 邮件 → 下载页列出版本 → 下载接口。
// 需要 SITE_DOWNLOADS=1（CI 的主套件已设置）和 fake 服务商。
test.skip(
  !siteConfig.downloads.enabled || process.env.BILLING_PROVIDER !== "fake",
  "需要 SITE_DOWNLOADS=1 和 BILLING_PROVIDER=fake",
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
  test.skip(isMobile, "购买流程只在桌面端跑一遍");
  await useRandomIp(page);
});

test("买下载套餐：成功页 → 邮件 → 下载页 → 下载接口", async ({ page }) => {
  // 先发布一个版本（等同于 pnpm downloads:publish，只是不传文件）。
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

  // 成功页：提示邮件已发，主按钮换成下载页。
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

  // 下载接口：登录的买家拿到跳转（本地 / CI 没配 R2 时是 503），未登录 401。
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

  // 版本表不挂在用户上：删掉这条，免得本地开发库的下载页越积越多。
  await withDatabase((client) =>
    client.query(
      "delete from download_releases where product_id = $1 and version = $2",
      [product.id, version],
    ),
  );
});

test("没买过：下载页是空状态", async ({ page }) => {
  await signIn(page, uniqueEmail("downloads-empty"));
  await page.goto("/downloads");
  await expect(page.getByText(d.empty)).toBeVisible();
  await expect(page.getByTestId("download-entitlement")).toHaveCount(0);
});
