import { expect, test } from "@playwright/test";

import messages from "../messages/en.json";
import siteConfig from "../site.config";
import { waitForEmail } from "../src/core/email/testing";
import {
  enterCode,
  requestCode,
  uniqueEmail,
  useRandomIp,
  withDatabase,
} from "./auth-helpers";

const t = messages.Auth;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const { allowedAttempts, resendCooldown } = siteConfig.auth.emailOtp;

test.beforeEach(async ({ page }) => {
  await useRandomIp(page);
});

test("验证码登录后进入 dashboard，首次注册收到欢迎邮件", async ({ page }) => {
  const email = uniqueEmail("login");
  const { code } = await requestCode(page, email);
  await enterCode(page, code);

  await expect(page).toHaveURL("/dashboard");
  await expect(page.getByTestId("signed-in-as")).toHaveText(
    t.dashboard.signedInAs.replace("{email}", email),
  );
  const welcome = await waitForEmail({ to: email, template: "welcome" });
  expect(welcome.subject).toContain(siteConfig.name);

  // 已登录时访问登录页会被送回 dashboard。
  await page.goto("/sign-in");
  await expect(page).toHaveURL("/dashboard");
});

test("没有配置 Google 凭据时不显示 Google 按钮", async ({ page }) => {
  test.skip(
    Boolean(process.env.GOOGLE_CLIENT_ID),
    "本地配置了 Google 凭据时跳过",
  );
  await page.goto("/sign-in");
  await expect(page.getByLabel(t.signIn.emailLabel)).toBeVisible();
  await expect(page.getByRole("button", { name: t.signIn.google })).toHaveCount(
    0,
  );
});

test(`验证码输错 ${allowedAttempts} 次后，正确的验证码也失效`, async ({
  page,
}) => {
  const email = uniqueEmail("attempts");
  const { code } = await requestCode(page, email);
  const wrong = code === "000000" ? "111111" : "000000";

  for (let i = 0; i < allowedAttempts; i++) {
    await enterCode(page, wrong);
    await expect(page.getByTestId("auth-error")).toHaveText(
      t.errors.invalidCode,
    );
  }
  await enterCode(page, code);
  await expect(page.getByTestId("auth-error")).toHaveText(
    t.errors.tooManyAttempts,
  );
  await expect(page).toHaveURL(/\/sign-in/);
});

test("验证码过期后失效", async ({ page }) => {
  const email = uniqueEmail("expired");
  const { code } = await requestCode(page, email);

  // 不等真实的 5 分钟：把这条验证码的过期时间改到过去。
  const updated = await withDatabase((db) =>
    db.query(
      "update verification set expires_at = now() - interval '1 minute' where identifier = $1",
      [`sign-in-otp-${email}`],
    ),
  );
  expect(updated.rowCount).toBe(1);

  await enterCode(page, code);
  // Better Auth 查询验证码时会顺带清理所有过期记录：记录还在时返回 OTP_EXPIRED，
  // 已被其他请求清理掉时返回 INVALID_OTP。两种情况验证码都已失效。
  await expect(page.getByTestId("auth-error")).toHaveText(
    new RegExp(
      `^(${escape(t.errors.codeExpired)}|${escape(t.errors.invalidCode)})$`,
    ),
  );
  await expect(page).toHaveURL(/\/sign-in/);
});

test(`${resendCooldown} 秒内不能重发验证码`, async ({ page }) => {
  const email = uniqueEmail("cooldown");
  await requestCode(page, email);

  const resend = page.getByRole("button", { name: /Resend/ });
  await expect(resend).toBeDisabled();
  await expect(resend).toHaveText(/Resend in \d+s/);

  // 绕过界面直接调接口，服务端同样拒绝。
  const response = await page.request.post(
    "/api/auth/email-otp/send-verification-otp",
    { data: { email, type: "sign-in" } },
  );
  expect(response.status()).toBe(429);
  expect(await response.json()).toMatchObject({ code: "RESEND_COOLDOWN" });
  expect(Number(response.headers()["retry-after"])).toBeGreaterThan(0);

  // 换个邮箱再切回来，重新提交同一邮箱时直接显示冷却提示。
  await page.getByRole("button", { name: t.signIn.changeEmail }).click();
  await page.getByLabel(t.signIn.emailLabel).fill(email);
  await page.getByRole("button", { name: t.signIn.sendCode }).click();
  await expect(page.getByTestId("auth-error")).toContainText(/wait \d+s/);
  await expect(page.getByLabel(t.signIn.codeLabel)).toBeVisible();
});

test("未登录访问受保护页面时跳到登录页，登录后跳回原页面", async ({ page }) => {
  await page.goto("/dashboard?from=e2e");
  await expect(page).toHaveURL(
    `/sign-in?callbackURL=${encodeURIComponent("/dashboard?from=e2e")}`,
  );

  const { code } = await requestCode(page, uniqueEmail("callback"));
  await enterCode(page, code);
  await expect(page).toHaveURL("/dashboard?from=e2e");
});

test("站外的 callbackURL 被忽略", async ({ page }) => {
  await page.goto(
    `/sign-in?callbackURL=${encodeURIComponent("https://evil.example/")}`,
  );
  const { code } = await requestCode(page, uniqueEmail("redirect"));
  await enterCode(page, code);
  await expect(page).toHaveURL("/dashboard");
});

test("退出登录后不能再访问 dashboard", async ({ page }) => {
  const { code } = await requestCode(page, uniqueEmail("signout"));
  await enterCode(page, code);
  await expect(page).toHaveURL("/dashboard");

  await page.getByRole("button", { name: t.signOut }).click();
  await expect(page).toHaveURL("/sign-in");

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in\?callbackURL=/);
});
