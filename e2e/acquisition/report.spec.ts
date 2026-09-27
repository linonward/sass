import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import messages from "../../messages/en.json";
import {
  clearResendCooldown,
  signIn,
  stubGoogleOneTap,
  uniqueEmail,
  useRandomIp,
} from "../auth-helpers";

const ad = messages.Admin;
const d = messages.Dashboard;
const t = ad.acquisition;
const port = Number(process.env.E2E_PORT ?? 3100) + 2;
const outboxDir = path.join(
  os.tmpdir(),
  `sass-acquisition-e2e-${port}`,
  ".tmp/emails",
);

/**
 * 管理员邮箱需要写进 ADMIN_EMAILS（见 .github/workflows/ci.yml）。
 * 每个 project 用一个，避免并行时同一邮箱触发验证码的重发冷却。
 */
const adminEmail = (project: string) => `e2e-admin-${project}@example.com`;

/**
 * 先关掉归因横幅再登录。它固定在底部，开着的时候正好盖住登录表单的按钮，
 * 点击会被拦下来（expect().toPass 重试也过不去）。
 */
async function acceptConsent(page: Page) {
  await page
    .getByRole("button", { name: messages.Acquisition.accept, exact: true })
    .click();
}

/** 在落地页记下来源、接受归因，再注册一个用户。 */
async function signUpFrom(page: Page, source: string, email: string) {
  await page.goto(`/?utm_source=${source}`);
  await acceptConsent(page);
  await signIn(page, email, { outboxDir });
}

test.describe("渠道报表", () => {
  // 同一个管理员邮箱只登录一次（验证码有重发冷却），用例按顺序共用这个页面。
  test.describe.configure({ mode: "serial" });

  let admin: Page;
  /** 第一个用例注册的来源，后面的筛选用例接着用。 */
  let source: string;

  test.beforeAll(async ({ browser }, testInfo) => {
    const email = adminEmail(testInfo.project.name);
    // 失败重试时会在冷却期内再次登录。
    await clearResendCooldown(email);
    admin = await (await browser.newContext()).newPage();
    await useRandomIp(admin);
    await stubGoogleOneTap(admin);
    await admin.goto("/");
    await acceptConsent(admin);
    await signIn(admin, email, { outboxDir });
  });

  test.afterAll(async () => {
    await admin?.context().close();
  });

  test("注册时冻结的来源出现在报表里，菜单里有入口", async ({
    browser,
    isMobile,
  }) => {
    source = `e2e-${randomUUID().slice(0, 8)}`;
    const landing = await (await browser.newContext()).newPage();
    await useRandomIp(landing);
    await stubGoogleOneTap(landing);
    await signUpFrom(landing, source, uniqueEmail("report"));
    await landing.context().close();

    // 后台菜单只在 /admin 下展开（dashboard 侧边栏只有一个 Admin 入口），
    // 所以先落到后台，再从菜单点进报表。
    await admin.goto("/admin/metrics");
    if (isMobile) {
      await admin.getByRole("button", { name: d.toggleSidebar }).click();
    }
    await admin
      .getByRole("list", { name: d.adminNav })
      .getByRole("link", { name: d.nav.adminAcquisition })
      .click();
    await expect(admin).toHaveURL("/admin/acquisition");
    await expect(
      admin.getByRole("heading", { level: 1, name: t.title }),
    ).toBeVisible();

    // 表格只认列，不给单行加测试用 id：按单元格里的来源名找行。
    const row = admin
      .getByRole("region", { name: t.channels.title })
      .getByRole("row")
      .filter({ hasText: source });
    await expect(row).toBeVisible();
    await expect(row.getByRole("cell").nth(1)).toHaveText("1");
  });

  test("按来源筛选，没有数据的来源显示空状态", async () => {
    const region = admin.getByRole("region", { name: t.channels.title });

    await admin.goto(`/admin/acquisition?source=${source}`);
    // 筛选结果只剩这一行，顶部没有编造出来的转化率或获客成本。
    await expect(region.getByRole("row")).toHaveCount(2);
    await expect(
      region.getByRole("cell", { name: source, exact: true }),
    ).toBeVisible();
    // 精确匹配：页面上还有归因偏好那个 aside（aria-label 也以 Source 开头）。
    await expect(
      admin.getByLabel(ad.acquisition.filters.source, { exact: true }),
    ).toHaveValue(source);

    // 格式合法但没人用过的来源：不报错，讲清为什么是空的。
    await admin.goto("/admin/acquisition?source=e2e-never-used");
    await expect(region.getByRole("row")).toHaveCount(2);
    await expect(region.getByText(t.empty)).toBeVisible();
  });

  test("普通用户访问渠道报表返回 404", async ({ browser }) => {
    const user = await (await browser.newContext()).newPage();
    await useRandomIp(user);
    await stubGoogleOneTap(user);
    await user.goto("/");
    await acceptConsent(user);
    await signIn(user, uniqueEmail("not-admin"), { outboxDir });
    expect((await user.goto("/admin/acquisition"))?.status()).toBe(404);
    await user.context().close();
  });

  // 后台是最容易横向溢出的地方：五列表格、一排筛选器。用同一 context 开新页面，登录态照旧。
  test("窄屏下渠道报表不横向溢出", async () => {
    const page = await admin.context().newPage();
    await page.setViewportSize({ width: 375, height: 740 });
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto("/admin/acquisition");
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, `${theme} 模式下溢出 ${overflow}px`).toBeLessThanOrEqual(
        0,
      );
    }
    await page.close();
  });
});
