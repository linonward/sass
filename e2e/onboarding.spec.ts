import { expect, test, type Page } from "@playwright/test";

import messages from "../messages/en.json";
import { placeholderIssues } from "../src/core/config/sentinels";
import siteConfig from "../site.config";
import {
  clearResendCooldown,
  openUserMenu,
  signIn,
  stubGoogleOneTap,
  uniqueEmail,
  useRandomIp,
  withDatabase,
} from "./auth-helpers";

const o = messages.Onboarding;
const d = messages.Dashboard;

/**
 * 出厂占位值是不是都还在。
 *
 * CI 用 SITE_NAME / CREEM_PRODUCT_ID_* 把站名和套餐产品 ID 覆盖成品牌化过的值
 * （见 .github/workflows/ci.yml，为的是让 `pnpm build` 的占位守卫过关），本地 dev
 * 保留出厂值。清单的判定跟着配置走，断言也跟着分叉 —— 两边都要能跑。
 */
const placeholdersGone = placeholderIssues(siteConfig).length === 0;

test.beforeEach(async ({ page }) => {
  await useRandomIp(page);
  // 本地配了 Google 凭据时登录页会去加载 GIS 脚本；本文件只关心验证码流程。
  await stubGoogleOneTap(page);
});

/** 按 data-step 取一行，不依赖文案顺序。 */
function step(page: Page, id: string) {
  return page.locator(`[data-testid="onboarding-step"][data-step="${id}"]`);
}

/** 用户记录上的完成标记：界面上看不到，只能直连数据库看。 */
async function completedFlag(email: string) {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ onboarding_completed: boolean }>(
      'select onboarding_completed from "user" where email = $1',
      [email],
    );
    return rows[0]?.onboarding_completed;
  });
}

/** 把判定不了的步骤（写文章、部署）勾上。跑在 Vercel 上时部署那步会自动完成，没有勾选框。 */
async function tickManualSteps(page: Page) {
  for (const id of ["blogPost", "deploy"]) {
    const box = step(page, id).getByRole("checkbox");
    if (await box.count()) await box.check();
    await expect(step(page, id)).toHaveAttribute("data-status", "done");
  }
}

test("新用户注册后自动落到清单，标完成写进用户记录", async ({ page }) => {
  const email = uniqueEmail("onboarding");
  await signIn(page, email);
  await expect(page).toHaveURL("/onboarding");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(o.title);

  await expect(page.getByTestId("onboarding-step")).toHaveCount(5);
  // 三个可跳转的步骤各挂一个「打开」链接。锁的是角色：它得是链接（会跳转），
  // 不是按钮 —— 见 checklist.tsx 里为什么这两个不走 Base UI 的 Button。
  await expect(
    page.getByTestId("onboarding-step").getByRole("link"),
  ).toHaveCount(3);
  // 品牌色没有环境变量可覆盖：出厂值还在时这一步就该是 todo，并把没改的值列出来。
  await expect(step(page, "brandColor")).toHaveAttribute("data-status", "todo");
  await expect(step(page, "brandColor")).toContainText("#0f766e");
  // 站名和套餐产品 ID 的判定取决于环境（见 placeholdersGone）。
  for (const id of ["siteName", "pricing"]) {
    await expect(step(page, id)).toHaveAttribute(
      "data-status",
      placeholdersGone ? "done" : "todo",
    );
  }
  if (!placeholdersGone) {
    // 未改的出厂值原样列出来，买家知道该改哪儿。
    await expect(step(page, "siteName")).toContainText('name = "Acme"');
    await expect(step(page, "pricing")).toContainText("prod_placeholder_pro");
  }

  // 勾选手动项只改当前页面：用户记录上还是「没完成」。
  await tickManualSteps(page);
  expect(await completedFlag(email)).toBeFalsy();

  await page.getByTestId("onboarding-complete").click();
  await expect(page).toHaveURL("/dashboard");
  expect(await completedFlag(email)).toBe(true);
});

test("标记完成后再次登录直接进站，不再自动跳转；清单还能从侧边栏进", async ({
  page,
  isMobile,
}) => {
  const email = uniqueEmail("onboarding-done");
  await signIn(page, email);
  await expect(page).toHaveURL("/onboarding");
  await page.getByTestId("onboarding-complete").click();
  await expect(page).toHaveURL("/dashboard");

  // 退出再进来：已完成的用户不多一次跳转。
  await openUserMenu(page, isMobile);
  await page.getByRole("menuitem", { name: d.userMenu.signOut }).click();
  await expect(page).toHaveURL("/sign-in");
  await clearResendCooldown(email);
  await signIn(page, email);
  await expect(page).toHaveURL("/dashboard");

  // 侧边栏里一直有这个入口，只是不再提示「标记完成」。
  if (isMobile) {
    await page.getByRole("button", { name: d.toggleSidebar }).click();
  }
  await page
    .getByRole("list", { name: d.businessNav })
    .getByRole("link", { name: d.nav.onboarding })
    .click();
  await expect(page).toHaveURL("/onboarding");
  await expect(page.getByTestId("onboarding-completed-at")).toBeVisible();
  await expect(page.getByTestId("onboarding-complete")).toHaveCount(0);
});

test("带 callbackURL 的登录尊重深链，不经过清单", async ({ page }) => {
  const email = uniqueEmail("onboarding-callback");
  await page.goto("/example");
  await expect(page).toHaveURL(/\/sign-in\?callbackURL=%2Fexample/);

  await signIn(page, email);
  await expect(page).toHaveURL("/example");
  // 深链登录不算「看过清单」：用户记录上还是没完成。
  expect(await completedFlag(email)).toBeFalsy();
});
