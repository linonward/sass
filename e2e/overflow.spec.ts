import { expect, test } from "@playwright/test";

import messages from "../messages/en.json";
import { stubGoogleOneTap } from "./auth-helpers";

// 375px 不横向溢出是 AGENTS.md 里点名要锁死的规则，但断言目前散在各页面的 spec 里
// （ui-shell 只覆盖营销首页，另有 blog、legal、dashboard、admin）。这里补上两个此前
// 完全没覆盖、却都要整页撑住的入口：
//
// - 404：`src/app/[locale]/not-found.tsx` 在 T607 之后自己渲染 SiteHeader（sticky + 硬
//   唇边阴影）、SiteFooter 和营销面的 44px 贴纸按钮 —— 它挂在 [locale]/ 下、穿不到营销面
//   layout，样式回归没有别的 CI 防线。`/missing.png` 走根级 `src/app/not-found.tsx`：没有
//   Header / Footer，但共用同一套 404 语域和那个 44px 按钮，一并锁住。
// - `/sign-in`：`(auth)` 组的 layout + 表单 + 段末两段内联链接，是匿名访客能到达的最窄
//   产品面页面（也是唯一一个无需登录就渲染完整布局的产品页）。
//
// 量法沿用既有 spec：`documentElement.scrollWidth - window.innerWidth`。
// 量之前先断一条内容 —— 页面退化成空白（渲染报错）时，宽度断言会假绿。
test.describe("375px 宽度", () => {
  test.use({ viewport: { width: 375, height: 740 } });

  for (const theme of ["light", "dark"] as const) {
    test(`${theme} 模式下 404 页不横向溢出`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      // /zh 是「未启用的语言前缀」：proxy 把它当无前缀路径重写，同样由 [locale] 的
      // not-found 接住（两条入口的 locale 不同，覆盖的取值路径不同）。
      for (const path of ["/does-not-exist", "/zh", "/missing.png"]) {
        const response = await page.goto(path);
        expect(response?.status()).toBe(404);
        await expect(
          page.getByRole("heading", {
            level: 1,
            name: messages.NotFound.title,
          }),
        ).toBeVisible();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(overflow, path).toBeLessThanOrEqual(0);
      }
    });
  }

  test.describe("sign-in 页", () => {
    // 本地 `.env.local` 配了 Google 凭据时，登录页会真的加载 GIS 脚本并尝试弹 One Tap
    // ——那个提示是 Google 自己的 fixed 定位 iframe，宽度不受本站样式约束。换掉它，
    // 量到的宽度才只归页面自己（CI 没有凭据，脚本本来就不会加载）。
    test.beforeEach(async ({ page }) => {
      await stubGoogleOneTap(page);
    });

    for (const theme of ["light", "dark"] as const) {
      test(`${theme} 模式下不横向溢出`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: theme });
        const response = await page.goto("/sign-in");
        expect(response?.status()).toBe(200);
        await expect(
          page.getByLabel(messages.Auth.signIn.emailLabel),
        ).toBeVisible();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }
  });
});
