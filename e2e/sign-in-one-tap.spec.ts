import { expect, test } from "@playwright/test";

import messages from "../messages/en.json";
import { useRandomIp } from "./auth-helpers";

/**
 * Google One Tap 的接线测试，**只在本地跑**：
 *
 * - CI 的 env 里没有 Google 凭据（见 `.github/workflows/ci.yml`），而 CSP 是构建期算出来的
 *   （`next.config.ts` 的 `headers()`），所以 CI 上登录页根本不会加载 GIS 脚本 —— 这里 stub 的
 *   请求都发不出去。
 * - 成功路径无法伪造：`/one-tap/callback` 会用 Google 的 JWKS 实时验签（better-auth 既没有
 *   缓存也没有覆盖入口），假 ID token 只能得到失败。真实登录走人工验证，见任务卡。
 *
 * 所以这条用例真正锁住的是「GIS 脚本被 CSP 放行 + 客户端接线正确」：白名单漏了 GIS 的源，
 * 脚本请求发不出去，下面的 stub 永远不会被命中，用例会超时失败。
 */
test.skip(!process.env.GOOGLE_CLIENT_ID, "本地没配 Google 凭据时跳过");

test.beforeEach(async ({ page }) => {
  await useRandomIp(page);
});

test("One Tap：弹提示 → 拿到 credential → 打回调接口，失败时提示出来", async ({
  page,
}) => {
  // 把 GIS 换成一个「立刻点了头像」的假实现。
  await page.route("https://accounts.google.com/gsi/client*", (route) =>
    route.fulfill({
      // 必须是 JS 的 MIME：Playwright 默认 text/plain，会被 nosniff 挡下。
      contentType: "application/javascript",
      body: `window.google = { accounts: { id: {
        initialize(config) { window.__oneTapCallback = config.callback; },
        prompt() {
          window.__oneTapCallback?.({ credential: "e2e-fake-id-token" });
        },
      } } };`,
    }),
  );

  const callback = page.waitForRequest((request) =>
    request.url().includes("/one-tap/callback"),
  );

  await page.goto("/sign-in");

  const request = await callback;
  expect(request.method()).toBe("POST");
  const body = request.postDataJSON();
  expect(body.idToken).toBe("e2e-fake-id-token");
  // callbackURL 必须一路传到服务端：插件靠它决定登录完跳哪儿，缺了会静默不跳转。
  expect(String(body.callbackURL)).toContain("/dashboard");

  // 假 token 过不了服务端验签，所以要看到失败提示（插件本身只是静默 return，
  // 报错是 src/core/auth/one-tap.ts 通过 fetchOptions.onError 接回来的）。
  await expect(page.getByTestId("auth-error")).toHaveText(
    messages.Auth.errors.googleFailed,
  );
});
