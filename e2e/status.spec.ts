import { randomUUID } from "node:crypto";

import { expect, test, type Browser, type Page } from "@playwright/test";

import messages from "../messages/en.json";
import { waitForEmail, type StoredEmail } from "../src/core/email/testing";
import {
  clearResendCooldown,
  signIn,
  uniqueEmail,
  useRandomIp,
  withDatabase,
} from "./auth-helpers";
import siteConfig from "../site.config";

const s = messages.Status;
const ad = messages.Admin.statusPage;
const d = messages.Dashboard;

/**
 * 管理员邮箱要写进 ADMIN_EMAILS（见 .github/workflows/ci.yml）。
 * 每个 project 用一个，避免并行时同一邮箱触发验证码的重发冷却。
 */
const adminEmail = (project: string) => `e2e-admin-${project}@example.com`;

/**
 * 邮件里的链接指向 `site.config.ts` 的域名（本地是 example.com，CI 是 ci.example.test），
 * 都不是测试服务器，所以只取路径部分再访问。令牌在查询串里，search 不能丢。
 */
const localLink = (raw: unknown) => {
  const url = new URL(String(raw));
  return url.pathname + url.search;
};

/** 带占位符的文案里 `{date}` 之前的部分，用来断言「有这一行」。 */
const labelPrefix = (value: string) => value.split("{date}")[0] ?? value;

const componentLabel = (key: string) => {
  const component = siteConfig.statusPage.components[key];
  if (!component) throw new Error(`site.config.ts 里没有组件 ${key}`);
  return component.label;
};

async function newPage(browser: Browser) {
  const page = await (await browser.newContext()).newPage();
  // useRandomIp 不是 React hook，只是名字以 use 开头。
  // eslint-disable-next-line react-hooks/rules-of-hooks
  await useRandomIp(page);
  return page;
}

/** `/status` 上某个组件的那一行：组件行是页面里唯一带三级标题的列表项。 */
function componentRow(page: Page, label: string) {
  return page
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: label, level: 3 }) });
}

test("访客打开 /status：横幅、每个组件一行、底部有订阅入口", async ({
  page,
}) => {
  const response = await page.goto("/status");
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { level: 1, name: s.title }),
  ).toBeVisible();
  await expect(page.getByTestId("status-overall")).toBeVisible();
  for (const component of Object.values(siteConfig.statusPage.components))
    await expect(componentRow(page, component.label)).toBeVisible();
  await expect(page.getByLabel(s.subscribe.label)).toBeVisible();
  await expect(
    page.getByRole("button", { name: s.subscribe.cta }),
  ).toBeVisible();
});

test.describe("375px 宽度", () => {
  test.use({ viewport: { width: 375, height: 740 } });

  for (const theme of ["light", "dark"] as const) {
    test(`${theme} 模式下 /status 不横向溢出`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto("/status");
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});

test.describe("incident 从创建到恢复", () => {
  // 同一个管理员邮箱只登录一次（验证码有重发冷却），用例按顺序共用这个页面。
  test.describe.configure({ mode: "serial" });

  /** 每次跑用不同的说明，断言不会读到上一次留下的 incident。 */
  const run = randomUUID().slice(0, 8);
  const message = `Elevated latency ${run}`;
  const updated = `Latency worse, investigating ${run}`;
  const email = uniqueEmail("status-sub");

  let admin: Page | undefined;
  let incidentMail: StoredEmail | undefined;

  // 桌面端和移动端共用一个数据库：写状态的用例只在桌面端跑一遍。否则两个 project
  // 并行时，一边还没恢复的 incident 会让另一边「全部正常」的断言失败（CI 上会变成
  // 间歇性失败）。移动端的布局由上面那条用例覆盖。
  const desktopOnly = "共享数据库，状态变更只在桌面端跑一遍";

  function adminPage() {
    if (!admin) throw new Error("管理员页面只在桌面端准备");
    return admin;
  }

  test.beforeAll(async ({ browser }, testInfo) => {
    if (testInfo.project.name !== "desktop") return;
    const page = await newPage(browser);
    const account = adminEmail(testInfo.project.name);
    // 失败重试时会在冷却期内再次登录。
    await clearResendCooldown(account);
    await signIn(page, account);
    admin = page;
    // 上一次跑挂在这里的 incident 会让「恢复后全部正常」失败。
    await withDatabase((db) => db.query("delete from status_events"));
  });

  test.afterAll(async () => {
    await admin?.context().close();
  });

  test("访客订阅：确认信 → 点确认 → 页面给回执，后台名单里是已确认", async ({
    browser,
    isMobile,
  }) => {
    test.skip(isMobile, desktopOnly);
    const since = new Date(Date.now() - 1000);
    const page = await newPage(browser);
    await page.goto("/status");
    await page.getByLabel(s.subscribe.label).fill(email);
    await page.getByRole("button", { name: s.subscribe.cta }).click();
    await expect(
      page.getByRole("status").filter({ hasText: s.subscribe.done }),
    ).toBeVisible();

    const mail = await waitForEmail({
      to: email,
      template: "status-subscription",
      since,
    });
    await page.goto(localLink(mail.props.confirmUrl));
    await expect(
      page.getByRole("status").filter({ hasText: s.notice.subscribed }),
    ).toBeVisible();

    const admin = adminPage();
    await admin.goto("/admin/status");
    const row = admin
      .getByRole("row")
      .filter({ has: admin.getByRole("cell", { name: email }) });
    await expect(row).toContainText(ad.subscribers.confirmed);
    await page.close();
  });

  test("管理员开 incident：访客看到 degraded，订阅者收到通知", async ({
    browser,
    isMobile,
  }) => {
    test.skip(isMobile, desktopOnly);
    const admin = adminPage();
    // dashboard 侧边栏里只有 Admin 一个入口，完整后台菜单在 /admin 里。
    await admin.goto("/dashboard");
    await admin
      .getByRole("list", { name: d.adminNav })
      .getByRole("link", { name: d.nav.admin })
      .click();
    await expect(admin).toHaveURL("/admin/users");
    // 状态页开启时后台菜单里才有这一项（关掉时页面 404，菜单也不该留入口）。
    await admin
      .getByRole("list", { name: d.adminNav })
      .getByRole("link", { name: d.nav.adminStatus })
      .click();
    await expect(admin).toHaveURL("/admin/status");
    await expect(
      admin.getByRole("heading", { level: 1, name: ad.title }),
    ).toBeVisible();

    const since = new Date(Date.now() - 1000);
    await admin.getByLabel(ad.create.component).selectOption("api");
    await admin.getByLabel(ad.create.status).selectOption("degraded");
    await admin.getByLabel(ad.create.message).fill(message);
    await admin.getByRole("button", { name: ad.create.submit }).click();
    await expect(
      admin.getByRole("status").filter({ hasText: ad.create.created }),
    ).toBeVisible();

    const visitor = await newPage(browser);
    await visitor.goto("/status");
    await expect(visitor.getByTestId("status-overall")).toHaveText(
      s.overall.degraded,
    );
    const row = componentRow(visitor, componentLabel("api"));
    await expect(
      row.getByText(s.statusLabel.degraded, { exact: true }),
    ).toBeVisible();
    await expect(row).toContainText(message);
    await expect(row).toContainText(labelPrefix(s.since));
    // 时间线里那条还在进行中。
    await expect(
      visitor.getByRole("listitem").filter({ hasText: s.ongoing }),
    ).toContainText(message);

    incidentMail = await waitForEmail({
      to: email,
      template: "status-incident",
      since,
    });
    expect(String(incidentMail.props.component)).toBe(componentLabel("api"));
    expect(String(incidentMail.props.message)).toBe(message);
    expect(String(incidentMail.subject)).toContain(componentLabel("api"));
    await visitor.close();
  });

  test("管理员改影响级别：访客看到 Major outage 和新的说明", async ({
    browser,
    isMobile,
  }) => {
    test.skip(isMobile, desktopOnly);
    const admin = adminPage();
    await admin.goto("/admin/status");
    const panel = admin.getByRole("listitem").filter({ hasText: message });
    await panel.getByLabel(ad.open.status).selectOption("outage");
    await panel.getByLabel(ad.open.message).fill(updated);
    await panel.getByRole("button", { name: ad.open.update }).click();
    // 提交后这一行换了说明，原来的定位符不再匹配，按新说明重新找。
    await expect(
      admin
        .getByRole("listitem")
        .filter({ hasText: updated })
        .getByRole("status")
        .filter({ hasText: ad.open.updated }),
    ).toBeVisible();

    const visitor = await newPage(browser);
    await visitor.goto("/status");
    await expect(visitor.getByTestId("status-overall")).toHaveText(
      s.overall.outage,
    );
    const row = componentRow(visitor, componentLabel("api"));
    await expect(
      row.getByText(s.statusLabel.outage, { exact: true }),
    ).toBeVisible();
    await expect(row).toContainText(updated);
    await visitor.close();
  });

  test("管理员标记恢复：访客看到全部正常，退订后后台名单里不再有", async ({
    browser,
    isMobile,
  }) => {
    test.skip(isMobile, desktopOnly);
    const admin = adminPage();
    await admin.goto("/admin/status");
    await admin
      .getByRole("listitem")
      .filter({ hasText: updated })
      .getByRole("button", { name: ad.open.resolve })
      .click();
    // 恢复之后它离开「进行中」，落到历史表里，并带上恢复时间。
    await expect(admin.getByText(ad.open.empty)).toBeVisible();
    const history = admin.getByRole("row").filter({ hasText: updated });
    await expect(history).not.toContainText(ad.ongoing);

    const visitor = await newPage(browser);
    await visitor.goto("/status");
    await expect(visitor.getByTestId("status-overall")).toHaveText(
      s.overall.operational,
    );
    const row = componentRow(visitor, componentLabel("api"));
    await expect(
      row.getByText(s.statusLabel.operational, { exact: true }),
    ).toBeVisible();
    await expect(
      visitor.getByRole("listitem").filter({ hasText: s.ongoing }),
    ).toHaveCount(0);
    await expect(
      visitor.getByRole("listitem").filter({ hasText: updated }),
    ).toContainText(labelPrefix(s.resolvedAt));

    if (!incidentMail) throw new Error("通知邮件在上一用例里没取到");
    await visitor.goto(localLink(incidentMail.props.withdrawUrl));
    await expect(
      visitor.getByRole("status").filter({ hasText: s.notice.unsubscribed }),
    ).toBeVisible();
    await admin.goto("/admin/status");
    await expect(admin.getByRole("cell", { name: email })).toHaveCount(0);
    await visitor.close();
  });
});
