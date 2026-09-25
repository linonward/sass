import { expect, test } from "@playwright/test";

import { signIn, uniqueEmail, useRandomIp } from "./auth-helpers";

// CI 没有 Creem 凭据，这里只验证接口的鉴权和"未配置"时的行为，不做真实支付。
// 本地如果在 .env.local 配了 Creem，改为验证签名校验和占位产品 ID 的拒绝。
const configured = Boolean(
  process.env.CREEM_API_KEY && process.env.CREEM_WEBHOOK_SECRET,
);

test.beforeEach(async ({ page }) => {
  await useRandomIp(page);
});

test("未登录时结账和客户门户返回 401", async ({ request }) => {
  const checkout = await request.post("/api/billing/checkout", {
    data: { planId: "pro" },
  });
  expect(checkout.status()).toBe(401);

  const portal = await request.get("/api/billing/portal", {
    maxRedirects: 0,
  });
  expect(portal.status()).toBe(401);
});

test("webhook 不接受未签名的请求", async ({ request }) => {
  const response = await request.post("/api/webhooks/creem", {
    data: { id: "evt_x", eventType: "checkout.completed", object: {} },
  });
  if (configured) {
    expect(response.status()).toBe(401);
  } else {
    expect(response.status()).toBe(503);
    expect(await response.json()).toEqual({ error: "billing_not_configured" });
  }
});

test("登录后调用结账：未配置 Creem 或产品 ID 仍是占位值时返回 503", async ({
  page,
}) => {
  await signIn(page, uniqueEmail("checkout"));
  const response = await page.request.post("/api/billing/checkout", {
    data: { planId: "pro" },
  });
  expect(response.status()).toBe(503);
  expect(await response.json()).toEqual({
    error: configured ? "plan_not_configured" : "billing_not_configured",
  });
});
