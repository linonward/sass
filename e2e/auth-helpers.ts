import { randomInt, randomUUID } from "node:crypto";

import { expect, type Page } from "@playwright/test";
import pg from "pg";

import messages from "../messages/en.json";
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
  await page.setExtraHTTPHeaders({ "x-forwarded-for": ip });
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
  await page.getByLabel(copy.Auth.signIn.emailLabel).fill(email);
  await page.getByRole("button", { name: copy.Auth.signIn.sendCode }).click();
  await expect(page.getByLabel(copy.Auth.signIn.codeLabel)).toBeVisible();
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
