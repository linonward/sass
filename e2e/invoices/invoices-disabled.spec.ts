import os from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

import messages from "../../messages/en.json";
import { signIn, uniqueEmail, useRandomIp } from "../auth-helpers";

/**
 * 关掉 `features.examples.invoices` 之后的样子（临时副本见 e2e/invoices/serve.ts）。
 * 打开时的行为由根套件的 e2e/invoices.spec.ts 覆盖，两份用例合起来钉住「开关两头都干净」。
 */
const inv = messages.Invoices;
const d = messages.Dashboard;
// 服务器跑在临时副本里，验证码落在它自己的 .tmp/emails（EMAIL_OUTBOX_DIR 相对进程 cwd）。
const port = Number(process.env.E2E_PORT ?? 3100) + 4;
const outboxDir = path.join(
  os.tmpdir(),
  `sass-invoices-e2e-${port}`,
  ".tmp/emails",
);

test("关掉后：侧边栏没有入口，直接访问 404", async ({ page, isMobile }) => {
  await useRandomIp(page);

  // 未登录也一样 404：判定在 proxy 里（src/core/auth/routes.ts 的 moduleGatedPages），
  // 不会先被送去登录页 —— 同一个地址对两种身份是同一个结果。
  expect((await page.goto("/invoices"))?.status()).toBe(404);

  await signIn(page, uniqueEmail("invoices-off"), { outboxDir });

  await page.goto("/dashboard");
  if (isMobile)
    await page.getByRole("button", { name: d.toggleSidebar }).click();
  const suite = page.getByRole("list", { name: d.suiteNav });
  // 菜单本身是渲染出来的（同一组里别的入口在），只是没有这一项 ——
  // 关掉开关不该留下一个点进去就 404 的入口。
  await expect(
    suite.getByRole("link", { name: d.nav.playground }),
  ).toBeVisible();
  await expect(suite.getByRole("link", { name: d.nav.invoices })).toHaveCount(
    0,
  );

  // 登录之后同样进不去：整页 404，不是空列表。
  expect((await page.goto("/invoices"))?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: inv.title })).toHaveCount(0);
});
