import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { expect, test, type Browser, type Page } from "@playwright/test";

import messages from "../../messages/en.json";
import {
  clearResendCooldown,
  findUserId,
  signIn,
  stubGoogleOneTap,
  uniqueEmail,
  // eslint 的 react-hooks 规则看到 use 前缀就当成 React Hook；它不是 Hook，用别名避开。
  useRandomIp as randomIp,
} from "../auth-helpers";

const ad = messages.Admin;
const d = messages.Dashboard;
const f = d.flags;
const t = ad.flags;
const port = Number(process.env.E2E_PORT ?? 3100) + 3;
const outboxDir = path.join(
  os.tmpdir(),
  `sass-flags-e2e-${port}`,
  ".tmp/emails",
);

/**
 * 和 src/core/flags/evaluate.ts 的 `flagBucket` 同算法：`sha256(userId + flagName)`
 * 前 8 位 hex → [0, 1)。这里独立算一遍，和页面上看到的对一对；算法本身由单测钉住。
 */
function bucket(userId: string, flagName: string) {
  const hex = createHash("sha256")
    .update(userId + flagName)
    .digest("hex")
    .slice(0, 8);
  return Number.parseInt(hex, 16) / 0x100000000;
}

/**
 * 管理员邮箱需要写进 ADMIN_EMAILS（见 .github/workflows/ci.yml 的 env）。
 * project 名已经带了套件名（flags-desktop / flags-mobile），每个 project 一个邮箱，
 * 避免并行时同一邮箱触发验证码的重发冷却。
 */
const adminEmail = (project: string) => `e2e-admin-${project}@example.com`;

/** 新开一个已经 stub 掉 Google One Tap、带独立 IP 的页面。 */
async function newPage(browser: Browser) {
  const page = await (await browser.newContext()).newPage();
  await randomIp(page);
  await stubGoogleOneTap(page);
  return page;
}

/** 注册一个新用户，返回邮箱和 user id（分桶要用 id，不是邮箱）。 */
async function signUp(page: Page, tag: string) {
  const email = uniqueEmail(tag);
  await signIn(page, email, { outboxDir });
  const userId = await findUserId(email);
  expect(userId, `user row for ${email}`).toBeTruthy();
  return userId!;
}

test.describe("管理员的 flag", () => {
  // 同一个管理员邮箱只登录一次（验证码有重发冷却），用例按顺序共用这个页面。
  test.describe.configure({ mode: "serial" });

  let admin: Page;

  test.beforeAll(async ({ browser }, testInfo) => {
    const email = adminEmail(testInfo.project.name);
    // 失败重试时会在冷却期内再次登录。
    await clearResendCooldown(email);
    admin = await newPage(browser);
    await signIn(admin, email, { outboxDir });
  });

  test.afterAll(async () => {
    await admin?.context().close();
  });

  test("admin 看到灰度中的新功能和只在后台可见的预览版，关掉的 flag 不渲染", async () => {
    await admin.goto("/dashboard");
    // beta-dashboard 是 50% 灰度，但 admin 不参与分桶：看到的永远是新区块，不是 fallback。
    await expect(admin.getByTestId("flag-beta-dashboard")).toBeVisible();
    await expect(admin.getByTestId("flag-beta-dashboard")).toContainText(
      f.dashboardOn,
    );
    await expect(admin.getByTestId("flag-beta-dashboard-off")).toHaveCount(0);
    // beta-preview 是 rollout 0 + adminOnly：只有 admin 看得到。
    await expect(admin.getByTestId("flag-beta-preview")).toBeVisible();
    // beta-soon 在配置里 enabled: false：对所有人都是 false，页面走「没开」的文案。
    await expect(admin.getByTestId("flag-beta-soon")).toHaveAttribute(
      "data-state",
      "off",
    );
    await expect(admin.getByTestId("flag-beta-soon")).toHaveText(f.soonOff);
  });

  test("后台 /admin/flags 列出全部定义，菜单里有入口", async ({ isMobile }) => {
    // 后台菜单只在 /admin 下展开（dashboard 侧边栏只有一个 Admin 入口）。
    await admin.goto("/admin/metrics");
    if (isMobile) {
      await admin.getByRole("button", { name: d.toggleSidebar }).click();
    }
    await admin
      .getByRole("list", { name: d.adminNav })
      .getByRole("link", { name: d.nav.adminFlags })
      .click();
    await expect(admin).toHaveURL("/admin/flags");
    await expect(
      admin.getByRole("heading", { level: 1, name: t.title }),
    ).toBeVisible();

    // 表格只认列，不给单行加测试用 id：按 flag 名找行，再按列序号取值。
    const table = admin.getByRole("region", { name: t.list.title });
    const row = (name: string) =>
      table.getByRole("row").filter({ hasText: name });
    const cell = (name: string, column: number) =>
      row(name).getByRole("cell").nth(column);

    await expect(row("beta-dashboard")).toBeVisible();
    await expect(cell("beta-dashboard", 2)).toHaveText(t.status.on);
    await expect(cell("beta-dashboard", 3)).toHaveText(
      t.rollout.replace("{percent}", "50"),
    );
    await expect(cell("beta-dashboard", 4)).toHaveText(t.access.everyone);

    await expect(cell("beta-preview", 3)).toHaveText(
      t.rollout.replace("{percent}", "0"),
    );
    await expect(cell("beta-preview", 4)).toHaveText(t.access.admins);

    await expect(cell("beta-soon", 2)).toHaveText(t.status.off);
    // 页面上写清楚为什么是只读的。
    await expect(admin.getByText(t.configHint)).toBeVisible();
  });

  // 后台是最容易横向溢出的地方：五列表格。用同一 context 开新页面，登录态照旧。
  test("窄屏下 flag 列表不横向溢出", async () => {
    const page = await admin.context().newPage();
    await page.setViewportSize({ width: 375, height: 740 });
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto("/admin/flags");
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

test("普通用户按 rollout 分桶：桶里的看到新布局，桶外的看到 fallback", async ({
  browser,
}) => {
  // 每个用户单独算一遍期望值：分桶是确定性的，所以断言不看运气。
  // 两侧是否都被抽到只做记录（annotation），不作为断言 —— 分桶的均匀性由单测覆盖。
  const sampled: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    const page = await newPage(browser);
    const userId = await signUp(page, "rollout");
    await page.goto("/dashboard");

    const inRollout = bucket(userId, "beta-dashboard") < 0.5;
    sampled.push(inRollout ? "in" : "out");
    await expect(
      page.getByTestId("flag-beta-dashboard"),
      `user ${userId} (bucket ${bucket(userId, "beta-dashboard")})`,
    ).toHaveCount(inRollout ? 1 : 0);
    await expect(page.getByTestId("flag-beta-dashboard-off")).toHaveCount(
      inRollout ? 0 : 1,
    );
    // rollout 0 + adminOnly：普通用户永远看不到。
    await expect(page.getByTestId("flag-beta-preview")).toHaveCount(0);
    // enabled: false 的 flag 对所有人都是 false。
    await expect(page.getByTestId("flag-beta-soon")).toHaveAttribute(
      "data-state",
      "off",
    );
    // 同一个页面再渲染一次（刷新），结果不变。
    await page.reload();
    await expect(page.getByTestId("flag-beta-dashboard")).toHaveCount(
      inRollout ? 1 : 0,
    );
    await page.context().close();
  }
  test.info().annotations.push({
    type: "rollout",
    description: `4 个普通用户的分桶：${sampled.join(", ")}`,
  });
});

test("非管理员访问后台 flag 列表返回 404", async ({ browser }) => {
  const page = await newPage(browser);
  await signIn(page, uniqueEmail("not-admin"), { outboxDir });
  expect((await page.goto("/admin/flags"))?.status()).toBe(404);
  await page.context().close();
});
