import { expect, test, type Browser } from "@playwright/test";

import messages from "../messages/en.json";
import {
  clearResendCooldown,
  enterCode,
  findUserId,
  requestCode,
  signIn,
  uniqueEmail,
  useRandomIp,
} from "./auth-helpers";

const ad = messages.Admin;
const d = messages.Dashboard;

/**
 * 管理员邮箱需要写进 ADMIN_EMAILS（见 .github/workflows/ci.yml）。
 * 每个 project 用一个，避免并行时同一邮箱触发验证码的重发冷却。
 */
const adminEmail = (project: string) => `e2e-admin-${project}@example.com`;

async function newSignedInPage(browser: Browser, email: string) {
  const page = await (await browser.newContext()).newPage();
  // useRandomIp 不是 React hook，只是名字以 use 开头。
  // eslint-disable-next-line react-hooks/rules-of-hooks
  await useRandomIp(page);
  await signIn(page, email);
  return page;
}

test("未登录访问 /admin 返回 404，不跳转登录页", async ({ page }) => {
  for (const path of [
    "/admin",
    "/admin/users",
    "/admin/orders",
    "/admin/metrics",
  ]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
    await expect(page).toHaveURL(path);
  }
});

test("普通用户访问后台返回 404，侧边栏没有后台入口", async ({
  page,
  isMobile,
}) => {
  await useRandomIp(page);
  const email = uniqueEmail("not-admin");
  await signIn(page, email);
  const userId = await findUserId(email);

  for (const path of [
    "/admin",
    "/admin/users",
    `/admin/users/${userId}`,
    "/admin/orders",
    "/admin/subscriptions",
    "/admin/metrics",
  ]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
  }

  await page.goto("/dashboard");
  if (isMobile) {
    await page.getByRole("button", { name: d.toggleSidebar }).click();
  }
  await expect(page.getByRole("list", { name: d.suiteNav })).toBeVisible();
  await expect(page.getByRole("list", { name: d.adminNav })).toHaveCount(0);
});

test.describe("管理员", () => {
  // 同一个管理员邮箱只登录一次（验证码有重发冷却），用例按顺序共用这个页面。
  test.describe.configure({ mode: "serial" });

  let admin: Awaited<ReturnType<typeof newSignedInPage>>;
  let email: string;

  test.beforeAll(async ({ browser }, testInfo) => {
    email = adminEmail(testInfo.project.name);
    // 失败重试时会在冷却期内再次登录。
    await clearResendCooldown(email);
    admin = await newSignedInPage(browser, email);
  });

  test.afterAll(async () => {
    await admin?.context().close();
  });

  test("ADMIN_EMAILS 里的邮箱登录后获得 admin 角色，dashboard 里有后台入口", async ({
    isMobile,
  }) => {
    await admin.goto("/dashboard");
    if (isMobile) {
      await admin.getByRole("button", { name: d.toggleSidebar }).click();
    }
    await admin
      .getByRole("list", { name: d.adminNav })
      .getByRole("link", { name: d.nav.admin })
      .click();
    await expect(admin).toHaveURL("/admin/users");
    await expect(
      admin.getByRole("heading", { level: 1, name: ad.users.title }),
    ).toBeVisible();
  });

  test("搜索用户，调整积分后余额和流水正确，并显示操作的管理员", async ({
    browser,
  }) => {
    const targetEmail = uniqueEmail("adjust");
    const target = await newSignedInPage(browser, targetEmail);
    await target.context().close();

    await admin.goto("/admin/users");
    await admin
      .getByRole("searchbox", { name: ad.users.search })
      .fill(targetEmail);
    await admin.getByRole("button", { name: ad.users.searchButton }).click();
    await expect(admin).toHaveURL(/\/admin\/users\?q=/);
    await admin.getByRole("link", { name: targetEmail }).click();
    await expect(
      admin.getByRole("heading", { level: 1, name: targetEmail }),
    ).toBeVisible();

    const form = admin.getByRole("form", { name: ad.user.adjust });
    await form.getByLabel(ad.user.amount).fill("25");
    await form.getByLabel(ad.user.reason, { exact: true }).fill("e2e bonus");
    await form.getByRole("button", { name: ad.user.adjust }).click();
    await expect(form.getByRole("status")).toHaveText(ad.user.adjusted);
    await expect(admin.getByTestId("admin-credit-balance")).toHaveText(
      "25 credits",
    );
    const entry = admin
      .getByTestId("admin-credit-transactions")
      .getByRole("listitem")
      .first();
    await expect(entry).toContainText("e2e bonus");
    await expect(entry).toContainText(`by ${email}`);
    await expect(entry).toContainText("+25");

    // 扣到负数被拒绝，余额不变。
    await form.getByLabel(ad.user.amount).fill("-100");
    await form.getByLabel(ad.user.reason, { exact: true }).fill("too much");
    await form.getByRole("button", { name: ad.user.adjust }).click();
    await expect(form.getByRole("alert")).toHaveText(ad.errors.insufficient);
    await expect(admin.getByTestId("admin-credit-balance")).toHaveText(
      "25 credits",
    );
  });

  test("封禁后用户被登出且无法再登录，解封后恢复", async ({ browser }) => {
    const targetEmail = uniqueEmail("ban");
    const target = await newSignedInPage(browser, targetEmail);
    const userId = await findUserId(targetEmail);

    await admin.goto(`/admin/users/${userId}`);
    const ban = admin.getByRole("form", { name: ad.user.ban });
    await ban.getByLabel(ad.user.banReason).fill("spam");
    await ban.getByRole("button", { name: ad.user.ban }).click();
    await expect(admin.getByText(ad.user.bannedNotice)).toBeVisible();

    // 已有的 session 失效：刷新后回到登录页。
    await target.reload();
    await expect(target).toHaveURL(/\/sign-in/);
    // 重新登录被拒绝。
    await clearResendCooldown(targetEmail);
    const { code } = await requestCode(target, targetEmail);
    await enterCode(target, code);
    await expect(target.getByTestId("auth-error")).toHaveText(
      messages.Auth.errors.banned,
    );

    await admin
      .getByRole("form", { name: ad.user.unban })
      .getByRole("button", { name: ad.user.unban })
      .click();
    await expect(admin.getByText(ad.user.banDescription)).toBeVisible();
    await target.context().close();
  });

  test("指标页显示注册和收入，可以切换时间范围", async ({ isMobile }) => {
    await admin.goto("/admin/users");
    if (isMobile) {
      await admin.getByRole("button", { name: d.toggleSidebar }).click();
    }
    await admin
      .getByRole("list", { name: d.adminNav })
      .getByRole("link", { name: d.nav.adminMetrics })
      .click();
    await expect(admin).toHaveURL("/admin/metrics");
    await expect(
      admin.getByRole("heading", { level: 1, name: ad.metrics.title }),
    ).toBeVisible();
    // 本用例的管理员今天刚注册，新注册数至少为 1。
    await expect(admin.getByTestId("metric-new-users")).not.toContainText(
      /^\D*0$/,
    );
    await expect(
      admin.getByRole("region", { name: ad.metrics.revenue.title }),
    ).toBeVisible();

    const range = admin.getByRole("navigation", {
      name: ad.metrics.range.label,
    });
    await range.getByRole("link", { name: "7 days" }).click();
    await expect(admin).toHaveURL("/admin/metrics?range=7");
    await expect(range.getByRole("link", { name: "7 days" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  // 产品面的横向溢出以前只测过营销首页（ui-shell）。后台是最容易溢出的地方：
  // 六列表格、30 根柱子的图表、一排筛选器。用同一 context 开新页面，登录态照旧。
  test("窄屏下指标页不横向溢出", async () => {
    const page = await admin.context().newPage();
    await page.setViewportSize({ width: 375, height: 740 });
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto("/admin/metrics");
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, `${theme} 模式下溢出 ${overflow}px`).toBeLessThanOrEqual(
        0,
      );
    }
    await page.close();
  });

  test("订单和订阅列表可以按状态筛选", async () => {
    for (const [path, label] of [
      ["/admin/orders", ad.orderStatus.paid],
      ["/admin/subscriptions", messages.Billing.page.status.active],
    ] as const) {
      await admin.goto(path);
      const filter = admin.getByRole("navigation", { name: ad.filter.label });
      await expect(
        filter.getByRole("link", { name: ad.filter.all, exact: true }),
      ).toHaveAttribute("aria-current", "page");
      await filter.getByRole("link", { name: label, exact: true }).click();
      await expect(admin).toHaveURL(new RegExp(`${path}\\?status=`));
      await expect(
        filter.getByRole("link", { name: label, exact: true }),
      ).toHaveAttribute("aria-current", "page");
    }
  });
});
