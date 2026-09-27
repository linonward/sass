import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import messages from "../../messages/en.json";
import siteConfig from "../../site.config";
import {
  REFERRAL_COOKIE,
  signContext,
} from "../../src/core/acquisition/tokens";
import { newReferralCode } from "../../src/core/acquisition/referrals/code";
import {
  clearResendCooldown,
  signIn,
  stubGoogleOneTap,
  uniqueEmail,
  // eslint 的 react-hooks 规则看到 use 前缀就当成 React Hook；它不是 Hook，用别名避开。
  useRandomIp as randomIp,
  withDatabase,
} from "../auth-helpers";

const t = messages.Referrals;
const invite = t.invite;
const port = Number(process.env.E2E_PORT ?? 3100) + 2;
const baseURL = `http://localhost:${port}`;
// 验证码邮件写进临时副本自己的目录，不在本 worktree 的 .tmp/emails。
const outboxDir = path.join(
  os.tmpdir(),
  `sass-acquisition-e2e-${port}`,
  ".tmp/emails",
);
/**
 * 关掉页面底部固定的归因偏好浮层。它盖在登录表单上，不关的话「Send code」永远点不到
 * （Playwright 会一直等它让开），本用例集不关心归因，按真实用户的做法点 Close。
 */
async function closeConsent(page: import("@playwright/test").Page) {
  const close = page.getByRole("button", {
    name: messages.Acquisition.close,
    exact: true,
  });
  // 浮层是页面加载后异步打开的，先等它一下；没出现就当作本来就没开。
  await close.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  if (await close.isVisible().catch(() => false)) await close.click();
}

const signInHere = async (
  page: import("@playwright/test").Page,
  email: string,
) => {
  // 先落到登录页再关浮层：浮层是每次页面加载后异步打开的，先关后跳会白关。
  if (!page.url().includes("/sign-in")) await page.goto("/sign-in");
  await closeConsent(page);
  await signIn(page, email, { outboxDir });
};

/**
 * 换身份登录：先清掉上一个人的会话 —— /sign-in 会把已登录的人直接送回 /dashboard，
 * 于是登录表单根本不会出现。顺带换一个 IP、清掉该邮箱的重发冷却。
 * 需要保留邀请上下文（referral cookie）的登录不要用它，用 signInHere。
 */
async function switchIdentity(
  page: import("@playwright/test").Page,
  email: string,
) {
  await page.context().clearCookies();
  await randomIp(page);
  await clearResendCooldown(email);
  await signInHere(page, email);
}

/** 受邀人名下已有的邀请关系；正常最多一条。 */
async function relationships(inviteeEmail: string) {
  return withDatabase(
    async (db) =>
      (
        await db.query<{ code: string; status: string; inviter: string }>(
          `select r.code, r.status, i.email as inviter
             from referral_relationships r
             join "user" u on u.id = r.invitee_user_id
             join "user" i on i.id = r.inviter_user_id
            where u.email = $1`,
          [inviteeEmail],
        )
      ).rows,
  );
}

/** 页面宽度断言：内容先落地再量，免得渲染失败时假绿。 */
async function expectNoOverflow(page: import("@playwright/test").Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

/** 取 ICU 复数消息里的某一个分支（e2e 只跑英文，取值够用）。 */
function plural(message: string, branch: string, count: number) {
  return message
    .split(`${branch} {`)[1]!
    .split("}")[0]!
    .replace("#", String(count));
}

test.beforeEach(async ({ page }) => {
  await randomIp(page);
  await stubGoogleOneTap(page);
});

test("复制链接 → 被邀请人注册前先看条件 → 接受后在登录跳转中绑定一次", async ({
  page,
}) => {
  const inviterEmail = uniqueEmail("referral-inviter");
  const inviteeEmail = uniqueEmail("referral-invitee");

  // 邀请人在 /referrals 拿到专属链接并复制。
  await signInHere(page, inviterEmail);
  await page.goto("/referrals");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.title);
  const code = (await page.getByTestId("referral-code").textContent())!.trim();
  expect(code).toMatch(/^[0-9a-hjkmnp-tv-z]{12}$/);
  const link = await page.getByTestId("referral-link").inputValue();
  // 链接是站点自己的绝对地址（和 sitemap/OG 用同一个 helper），不是当前请求的 host。
  expect(link).toBe(`https://${siteConfig.domain}/invite/${code}`);
  // 页面上没有任何受邀人名下的关系，邀请记录是空状态。
  await expect(page.getByText(t.notInvitedTitle)).toBeVisible();
  await expect(page.getByText(t.invitedEmpty)).toBeVisible();
  await expectNoOverflow(page);

  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await closeConsent(page);
  await page.getByTestId("referral-copy").click();
  await expect(page.getByTestId("referral-copy")).toHaveAttribute(
    "data-state",
    "copied",
  );
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);

  // 换成被邀请人的浏览器：接受前必须先看到邀请提示与条件，此时什么都不写。
  // 验证码注册的账号没有昵称，这里写一个，顺带锁住「邀请人姓名出现在邀请页」那条分支。
  await withDatabase((db) =>
    db.query('update "user" set name = $1 where email = $2', [
      "Inviter Name",
      inviterEmail,
    ]),
  );
  await page.context().clearCookies();
  await page.goto(`/invite/${code}`);
  await expect(page.getByTestId("invite-title")).toHaveText(
    invite.fromTitle.replace("{name}", "Inviter Name"),
  );
  await expect(page.getByText(invite.rewardsOff)).toBeVisible();
  await expect(page.getByText(invite.termsVoluntary)).toBeVisible();
  await expect(page.getByText(invite.termsIdentity)).toBeVisible();
  expect(
    (await page.context().cookies()).some(
      (cookie) => cookie.name === REFERRAL_COOKIE,
    ),
  ).toBe(false);
  await expectNoOverflow(page);

  await closeConsent(page);
  await page.getByTestId("referral-accept").click();
  await expect(page.getByTestId("invite-title")).toHaveText(
    invite.acceptedTitle,
  );
  const referralCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === REFERRAL_COOKIE,
  )!;
  expect(referralCookie).toMatchObject({ httpOnly: true, sameSite: "Lax" });
  // 邀请上下文里只有码，没有邮箱。
  expect(
    Buffer.from(referralCookie.value.split(".")[0]!, "base64url").toString(),
  ).not.toContain(inviteeEmail);

  // 接受后跨登录跳转注册：注册时绑定，落回 /referrals 看到自己是受邀人。
  await page.getByRole("link", { name: invite.acceptedCta }).click();
  // 等 CTA 把浏览器带到带 callbackURL 的登录页，别让包装函数抢在前面重定向走。
  await page.waitForURL((url) => url.pathname.endsWith("/sign-in"));
  await signInHere(page, inviteeEmail);
  await expect(page).toHaveURL("/referrals");
  await expect(page.getByText(t.invitedByTitle)).toBeVisible();
  await expect(
    page.getByText(
      t.invitedByDescription.replace("{status}", t.status.awaiting_payment),
    ),
  ).toBeVisible();
  expect(await relationships(inviteeEmail)).toEqual([
    { code, status: "awaiting_payment", inviter: inviterEmail },
  ]);
  // 回访问卷页也不会再绑一次：关系仍然只有一条。
  await page.goto(`/invite/${code}`);
  await expect(page.getByTestId("invite-title")).toHaveText(invite.boundTitle);
  await page.goto("/referrals");
  expect(await relationships(inviteeEmail)).toHaveLength(1);

  // 邀请人只看得到状态与时间，看不到受邀人的身份。
  await switchIdentity(page, inviterEmail);
  await page.goto("/referrals");
  const invited = page.getByTestId("referral-invited");
  await expect(invited.getByRole("listitem")).toHaveCount(1);
  await expect(page.getByTestId("referral-invited-status")).toHaveText(
    t.status.awaiting_payment,
  );
  await expect(page.getByText(t.invitedEmpty)).toHaveCount(0);
  const html = await page.content();
  expect(html).not.toContain(inviteeEmail);
  expect(html).not.toContain(inviteeEmail.split("@")[0]!);
});

test("拒绝邀请不写上下文，之后的注册照常", async ({ page }) => {
  const inviterEmail = uniqueEmail("referral-declined-by");
  const inviteeEmail = uniqueEmail("referral-decliner");

  await signInHere(page, inviterEmail);
  await page.goto("/referrals");
  const code = (await page.getByTestId("referral-code").textContent())!.trim();

  await page.context().clearCookies();
  await page.goto(`/invite/${code}`);
  await closeConsent(page);
  await page.getByTestId("referral-decline").click();
  // 拒绝后给一句明确的确认，并且上下文真的被清掉了。
  await expect(page.getByText(invite.declined)).toBeVisible();
  await expect(page.getByTestId("referral-decline")).toHaveCount(0);
  expect(
    (await page.context().cookies()).some(
      (cookie) => cookie.name === REFERRAL_COOKIE,
    ),
  ).toBe(false);

  // 拒绝之后注册一切照旧，只是没有邀请关系。
  await switchIdentity(page, inviteeEmail);
  await page.goto("/referrals");
  await expect(page.getByText(t.notInvitedTitle)).toBeVisible();
  await expect(page.getByText(t.invitedEmpty)).toBeVisible();
  expect(await relationships(inviteeEmail)).toEqual([]);
});

test("已接受过一份邀请时，第二份只提供清除，不给会静默失败的接受按钮", async ({
  page,
}) => {
  const firstInviter = uniqueEmail("referral-first-by");
  const secondInviter = uniqueEmail("referral-second-by");

  const codeOf = async (email: string) => {
    await switchIdentity(page, email);
    await page.goto("/referrals");
    return (await page.getByTestId("referral-code").textContent())!.trim();
  };
  const first = await codeOf(firstInviter);
  const second = await codeOf(secondInviter);

  // 新访客先接受第一份邀请。
  await page.context().clearCookies();
  await page.goto(`/invite/${first}`);
  await closeConsent(page);
  await page.getByTestId("referral-accept").click();
  await expect(page.getByTestId("invite-title")).toHaveText(
    invite.acceptedTitle,
  );

  // 再打开第二份：说明第一份仍然有效，并且不给接受按钮（服务端不会换，点了也没有反馈）。
  await page.goto(`/invite/${second}`);
  await expect(page.getByTestId("invite-title")).toHaveText(invite.otherTitle);
  await expect(page.getByText(invite.otherBody)).toBeVisible();
  await expect(page.getByTestId("referral-accept")).toHaveCount(0);

  // 按页面说的先清除：给一句确认，页面回到可以接受这一份的状态。
  await closeConsent(page);
  await page.getByTestId("referral-decline").click();
  await expect(page.getByText(invite.cleared)).toBeVisible();
  await expect(page.getByTestId("referral-accept")).toBeVisible();

  // 现在接受这一份是真的接受了：上下文里的码换成第二份。
  await page.getByTestId("referral-accept").click();
  await expect(page.getByTestId("invite-title")).toHaveText(
    invite.acceptedTitle,
  );
  const cookie = (await page.context().cookies()).find(
    (item) => item.name === REFERRAL_COOKIE,
  )!;
  const context = JSON.parse(
    Buffer.from(cookie.value.split(".")[0]!, "base64url").toString(),
  ) as { code: string };
  expect(context.code).toBe(second);
});

test("邀请超过一页时，条数是真实总数，列表说明只显示最近一批", async ({
  page,
}) => {
  const inviterEmail = uniqueEmail("referral-many");
  const seedPrefix = `referral-seeded-${Date.now()}-`;

  await signInHere(page, inviterEmail);
  await page.goto("/referrals");
  const code = (await page.getByTestId("referral-code").textContent())!.trim();
  const invited = page.getByTestId("referral-invited");
  const inviterId = (await withDatabase(async (db) => {
    const { rows } = await db.query<{ id: string }>(
      'select id from "user" where email = $1',
      [inviterEmail],
    );
    return rows[0]?.id ?? null;
  }))!;

  // 直接种 51 条关系：注册 51 个账号太慢，这里要验证的是页面怎么显示已有数据。
  // 编号越小种得越晚，被截断的应该是最早的那一条（编号 51）。
  await withDatabase(async (db) => {
    await db.query(
      `insert into "user" (id, name, email, email_verified, created_at)
       select gen_random_uuid()::text, 'Seeded', $1 || g || '@example.test', true, now()
         from generate_series(1, 51) g`,
      [seedPrefix],
    );
    await db.query(
      `insert into referral_relationships
         (invitee_user_id, inviter_user_id, code, status, created_at)
       select u.id, $1, $2, 'awaiting_payment', now() - (g || ' minutes')::interval
         from generate_series(1, 51) g
         join "user" u on u.email = $3 || g || '@example.test'`,
      [inviterId, code, seedPrefix],
    );
  });

  try {
    await page.reload();
    await expect(invited.getByRole("listitem")).toHaveCount(50);
    // 条数是 51，列表只有 50 条 —— 说明写清楚这个差别，别让人以为少了一条。
    await expect(
      page.getByText(plural(t.invitedCount, "other", 51)),
    ).toBeVisible();
    await expect(
      page.getByText(t.invitedShown.replace("{shown}", "50")),
    ).toBeVisible();
  } finally {
    await withDatabase((db) =>
      db.query('delete from "user" where email like $1', [`${seedPrefix}%`]),
    );
  }
});

test("过期的邀请上下文在注册时被忽略", async ({ page }) => {
  const inviterEmail = uniqueEmail("referral-expired-by");
  const inviteeEmail = uniqueEmail("referral-expired");

  await signInHere(page, inviterEmail);
  await page.goto("/referrals");
  const code = (await page.getByTestId("referral-code").textContent())!.trim();

  // 31 天前接受的邀请：签名有效、码也有效，只有窗口过期。
  await page.context().clearCookies();
  await page.context().addCookies([
    {
      name: REFERRAL_COOKIE,
      value: signContext(
        {
          v: 1,
          purpose: "referral",
          code,
          acceptedAt: Date.now() - 31 * 24 * 60 * 60 * 1000,
        },
        process.env.BETTER_AUTH_SECRET!,
      ),
      url: baseURL,
      httpOnly: true,
    },
  ]);
  await page.goto(`/invite/${code}`);
  await expect(page.getByTestId("invite-title")).toHaveText(
    invite.genericTitle,
  );

  await signInHere(page, inviteeEmail);
  await page.goto("/referrals");
  await expect(page.getByText(t.notInvitedTitle)).toBeVisible();
  expect(await relationships(inviteeEmail)).toEqual([]);
});

test("无效链接与自邀都不能建立关系", async ({ page }) => {
  const inviterEmail = uniqueEmail("referral-self");
  const strangerEmail = uniqueEmail("referral-stranger");

  // 格式对但没人用的码：只说链接无效，不给任何归属线索。
  await page.goto(`/invite/${newReferralCode()}`);
  await expect(page.getByTestId("invite-title")).toHaveText(
    invite.invalidTitle,
  );
  await expect(page.getByTestId("referral-accept")).toHaveCount(0);

  await signInHere(page, inviterEmail);
  await page.goto("/referrals");
  const code = (await page.getByTestId("referral-code").textContent())!.trim();

  // 自邀：链接能用，但页面不给接受按钮。
  await page.goto(`/invite/${code}`);
  await expect(page.getByTestId("invite-title")).toHaveText(invite.selfTitle);
  await expect(page.getByTestId("referral-accept")).toHaveCount(0);
  expect(await relationships(inviterEmail)).toEqual([]);

  // 老账号：邀请只在创建账号时记录，已有账号加不上。
  await switchIdentity(page, strangerEmail);
  await page.goto(`/invite/${code}`);
  await expect(page.getByTestId("invite-title")).toHaveText(
    invite.signedInTitle,
  );
  await expect(page.getByTestId("referral-accept")).toHaveCount(0);
  await page.goto("/referrals");
  await expect(page.getByText(t.notInvitedTitle)).toBeVisible();
  expect(await relationships(strangerEmail)).toEqual([]);
});
