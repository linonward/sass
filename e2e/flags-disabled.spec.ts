import { expect, test } from "@playwright/test";

import messages from "../messages/en.json";
import { signIn, uniqueEmail, useRandomIp } from "./auth-helpers";

/**
 * 出厂状态：`userFlags.enabled: false`（见 site.config.ts）。
 * 打开后的行为由 `e2e/flags/` 那套临时副本覆盖（那个套件跑在另一个端口上）。
 */
test("总开关关着时 Dashboard 上没有 flag 区块，后台 flag 列表也不存在", async ({
  page,
}) => {
  await useRandomIp(page);
  await signIn(page, uniqueEmail("flags-off"));

  // 整段示例都不渲染：连 fallback 都没有，页面和没接这个模块时一样。
  await page.goto("/dashboard");
  await expect(page.getByTestId("flag-example")).toHaveCount(0);
  await expect(page.getByTestId("flag-beta-dashboard")).toHaveCount(0);
  await expect(page.getByTestId("flag-beta-dashboard-off")).toHaveCount(0);

  // 后台页面同样 404（模块关着；非管理员本来就进不去）。
  expect((await page.goto("/admin/flags"))?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: messages.Admin.flags.title }),
  ).toHaveCount(0);
});
