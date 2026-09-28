import { expect, test, type Page } from "@playwright/test";

import messages from "../messages/en.json";
import { waitForEmail } from "../src/core/email/testing";
import {
  clearResendCooldown,
  findUserId,
  signIn,
  uniqueEmail,
  useRandomIp,
  withDatabase,
} from "./auth-helpers";

const a = messages.Auth.signIn;

test.beforeEach(async ({ page }) => {
  await useRandomIp(page);
});

/**
 * 直接调 auth 的接口，并断言 HTTP 层成功（失败时把响应体带进断言信息）。
 *
 * 带 cookie 的请求会过 Better Auth 的 CSRF 校验：`page.request` 不是浏览器发的，没有
 * `Origin` 头，所以这里显式补一个 —— 不然会拿到 MISSING_OR_NULL_ORIGIN。
 */
async function post(
  page: Page,
  path: string,
  data: Record<string, string>,
  origin: string,
) {
  const response = await page.request.post(`/api/auth${path}`, {
    data,
    headers: { origin },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response;
}

/** 从发件箱取改邮箱流程的验证码。 */
async function changeEmailCode(to: string, since: Date) {
  const mail = await waitForEmail({ to, template: "change-email-code", since });
  return { code: String(mail.props.code), mail };
}

// 改邮箱接口目前没有设置页入口（见 docs/plan.md 的会话失效决策），所以这里直接调接口。
// 改邮箱是安全敏感操作：改完之后，改之前建立的 session（包括当前这个）必须全部失效。
test("改邮箱成功后旧 session 立即失效，新邮箱可以重新登录", async ({
  page,
  baseURL,
}) => {
  const origin = baseURL!;
  const email = uniqueEmail("email-change");
  const newEmail = uniqueEmail("email-changed");

  await signIn(page, email);
  // 新用户注册后的第一落点是引导页；这一例测的是会话失效，先回 dashboard 再往下走。
  await expect(page).toHaveURL("/onboarding");
  await page.goto("/dashboard");
  const userId = await findUserId(email);
  expect(userId).toBeTruthy();

  // 1) 当前邮箱的验证码（changeEmail.verifyCurrentEmail 要求的第二步）。
  await clearResendCooldown(email);
  const sinceCurrent = new Date(Date.now() - 1000);
  await post(
    page,
    "/email-otp/send-verification-otp",
    { email, type: "email-verification" },
    origin,
  );
  const current = await changeEmailCode(email, sinceCurrent);
  // 发往当前邮箱的那封是"确认是你发起的变更"。
  expect(current.mail.props.forNewEmail).toBe(false);

  // 2) 用它换新邮箱的验证码（新邮箱已被占用时这一步不发信）。
  const sinceChange = new Date(Date.now() - 1000);
  await post(
    page,
    "/email-otp/request-email-change",
    { newEmail, otp: current.code },
    origin,
  );
  const next = await changeEmailCode(newEmail, sinceChange);
  expect(next.mail.props.forNewEmail).toBe(true);
  // 两封信措辞不同，收件人分得清自己在确认哪一步。
  expect(next.mail.subject).not.toBe(current.mail.subject);

  // 3) 提交新邮箱的验证码，邮箱改成新地址。
  const changed = await post(
    page,
    "/email-otp/change-email",
    { newEmail, otp: next.code },
    origin,
  );
  expect(await changed.json()).toEqual({ success: true });

  // 旧 session 立刻失效：浏览器里的 cookie 还在，但已经不是有效 session。
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByLabel(a.emailLabel)).toBeVisible();

  // 数据库里该用户的 session 一行不剩，邮箱已换成新地址；旧地址不再是任何账户的邮箱。
  const left = await withDatabase(async (client) => ({
    sessions: Number(
      (
        await client.query("select count(*) from session where user_id = $1", [
          userId,
        ])
      ).rows[0].count,
    ),
    emails: (
      await client.query<{ email: string }>(
        'select email from "user" where id = $1',
        [userId],
      )
    ).rows,
  }));
  expect(left.sessions).toBe(0);
  expect(left.emails).toEqual([{ email: newEmail }]);
  expect(await findUserId(email)).toBeUndefined();

  // 新邮箱能登录，而且进的是同一个账户。
  // 这次登录前浏览器里还留着已经失效的 cookie，/dashboard 会由页面自己送去不带
  // callbackURL 的 /sign-in（带 cookie 时 proxy 不插手），所以还是先落引导页。
  await useRandomIp(page);
  await signIn(page, newEmail);
  await expect(page).toHaveURL("/onboarding");
  expect(await findUserId(newEmail)).toBe(userId);
});
