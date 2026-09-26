import { randomInt, randomUUID } from "node:crypto";

import { expect, type Page } from "@playwright/test";
import pg from "pg";

import messages from "../messages/en.json";
import { cooldownIdentifier } from "../src/core/auth/cooldown";
import { waitForEmail } from "../src/core/email/testing";

/** 每个用例用独立的邮箱，互不干扰。 */
export function uniqueEmail(tag: string) {
  return `e2e-${tag}-${randomUUID().slice(0, 8)}@example.com`;
}

/**
 * 给页面固定一个随机的客户端 IP。生产构建会开启 Better Auth 的按 IP 限流，
 * 各用例使用不同 IP，避免并行时互相触发限流。
 */
export async function useRandomIp(page: Page) {
  const ip = `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
  // 设在 context 上，页面请求和 page.request 直接调接口都会带上。
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": ip });
}

/**
 * 把 GIS 脚本换成「浏览器上没有 Google 会话」的假实现。
 *
 * 本地 `.env.local` 配了 Google 凭据时，登录页会真的去加载 `accounts.google.com` 的脚本
 * 并尝试弹 One Tap 提示。验证码相关的用例不关心它，stub 掉才能确定、且不依赖 Google 的
 * 可用性。真实的接线由 `e2e/sign-in-one-tap.spec.ts` 覆盖。
 */
export async function stubGoogleOneTap(page: Page) {
  await page.route("https://accounts.google.com/gsi/client*", (route) =>
    route.fulfill({
      // 必须是 JS 的 MIME：Playwright 默认 text/plain，会被 nosniff 挡下。
      contentType: "application/javascript",
      body: `window.google = { accounts: { id: {
        initialize() {},
        prompt(notify) {
          // 告诉插件提示没显示出来，让它收尾 —— 插件内部的并发标志只在收到通知时才复位。
          notify?.({ isNotDisplayed: () => true, getNotDisplayedReason: () => "opt_out_or_no_session" });
        },
      } } };`,
    }),
  );
}

type Copy = typeof messages;

/** 在登录页提交邮箱，并从 `.tmp/emails/` 取回验证码。 */
export async function requestCode(
  page: Page,
  email: string,
  {
    copy = messages,
    signInPath = "/sign-in",
    outboxDir,
  }: { copy?: Copy; signInPath?: string; outboxDir?: string } = {},
) {
  const since = new Date(Date.now() - 1000);
  if (!page.url().includes("/sign-in")) await page.goto(signInPath);
  // hydration 完成前填的值会被 React 重置，点击后只会提示邮箱无效（不会发出请求），
  // 所以重复"填写并发送"，直到出现验证码输入框。
  await expect(async () => {
    await page.getByLabel(copy.Auth.signIn.emailLabel).fill(email);
    await page.getByRole("button", { name: copy.Auth.signIn.sendCode }).click();
    await expect(page.getByLabel(copy.Auth.signIn.codeLabel)).toBeVisible({
      timeout: 2000,
    });
  }).toPass({ timeout: 15_000 });
  const mail = await waitForEmail(
    { to: email, template: "sign-in-code", since },
    outboxDir ? { dir: outboxDir } : undefined,
  );
  return { code: String(mail.props.code), mail };
}

/** 输入验证码（输满位数后自动提交）。 */
export async function enterCode(
  page: Page,
  code: string,
  copy: Copy = messages,
) {
  await page.getByLabel(copy.Auth.signIn.codeLabel).fill(code);
}

/** 直连应用使用的数据库，用于构造"验证码已过期"等无法等待的状态。 */
export async function withDatabase<T>(run: (client: pg.Client) => Promise<T>) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/** 完成一次验证码登录，停在登录后的页面。 */
export async function signIn(
  page: Page,
  email: string,
  options: Parameters<typeof requestCode>[2] = {},
) {
  const { code } = await requestCode(page, email, options);
  await enterCode(page, code, options.copy);
  // 等跳转完成（session cookie 已写入）再继续。
  await page.waitForURL((url) => !url.pathname.endsWith("/sign-in"));
}

/** 清掉某个邮箱的验证码重发冷却，让同一用例里可以马上再登录一次。 */
export async function clearResendCooldown(email: string) {
  await withDatabase((client) =>
    client.query("delete from verification where identifier = $1", [
      cooldownIdentifier(email),
    ]),
  );
}

/** 按邮箱查用户 id；不存在时为 undefined。 */
export async function findUserId(email: string) {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      'select id from "user" where email = $1',
      [email],
    );
    return rows[0]?.id;
  });
}

/** 打开侧边栏里的用户菜单（移动端先展开抽屉）。 */
export async function openUserMenu(page: Page, isMobile: boolean) {
  const d = messages.Dashboard;
  // hydration 完成前点击没有反应，所以点到菜单真正出现为止。
  await expect(async () => {
    if (isMobile) {
      const trigger = page.getByRole("button", { name: d.userMenu.open });
      if (!(await trigger.isVisible())) {
        await page.getByRole("button", { name: d.toggleSidebar }).click();
      }
    }
    await page.getByRole("button", { name: d.userMenu.open }).click();
    await expect(page.getByRole("menu")).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });
}
