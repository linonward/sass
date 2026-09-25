import { expect, test } from "@playwright/test";

import messages from "../messages/en.json";
import {
  findUserId,
  signIn,
  uniqueEmail,
  useRandomIp,
  withDatabase,
} from "./auth-helpers";

const d = messages.Dashboard;
const a = messages.Account;

test.beforeEach(async ({ page }) => {
  await useRandomIp(page);
});

test("侧边栏在 Dashboard 和设置页之间导航，当前项高亮", async ({
  page,
  isMobile,
}) => {
  await signIn(page, uniqueEmail("nav"));
  await expect(page).toHaveURL("/dashboard");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    d.home.title,
  );

  // 移动端侧边栏是抽屉，先打开。
  if (isMobile) {
    await page.getByRole("button", { name: d.toggleSidebar }).click();
  }
  const main = page.getByRole("list", { name: d.suiteNav });
  await expect(main.getByRole("link", { name: d.nav.home })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await main.getByRole("link", { name: d.nav.settings }).click();

  await expect(page).toHaveURL("/settings");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(a.title);
  if (isMobile) {
    // 点了链接后抽屉自动收起。
    await expect(main).toBeHidden();
  }
});

test("修改名称后刷新仍然保持，并显示在用户菜单和欢迎语里", async ({ page }) => {
  await signIn(page, uniqueEmail("name"));
  await page.goto("/settings");

  const name = `Ada ${Date.now() % 10000}`;
  const form = page.getByRole("form", { name: a.name.label });
  await form.getByRole("textbox", { name: a.name.label }).fill(name);
  await form.getByRole("button", { name: a.name.save }).click();
  await expect(page.getByRole("status")).toHaveText(a.status.saved);

  await page.reload();
  await expect(page.getByRole("textbox", { name: a.name.label })).toHaveValue(
    name,
  );

  await page.goto("/dashboard");
  await expect(page.getByTestId("signed-in-as")).toHaveText(
    d.home.welcomeName.replace("{name}", name),
  );
});

test("删除账户：二次确认、跳回首页、数据被清除，再次登录是新账户", async ({
  page,
}) => {
  const email = uniqueEmail("delete");
  await signIn(page, email);
  await expect(page).toHaveURL("/dashboard");
  const oldId = await findUserId(email);
  expect(oldId).toBeTruthy();

  await page.goto("/settings");
  await page.getByRole("button", { name: a.delete.open }).click();
  const dialog = page.getByRole("dialog", { name: a.delete.title });
  const confirm = dialog.getByRole("button", { name: a.delete.confirm });

  // 输入的邮箱不对时不能提交。
  await expect(confirm).toBeDisabled();
  await dialog.getByRole("textbox").fill("someone-else@example.com");
  await expect(confirm).toBeDisabled();
  await dialog.getByRole("textbox").fill(email.toUpperCase());
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect(page).toHaveURL("/");

  // 旧会话立即失效。
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in\?callbackURL=/);

  // 数据库里该用户及其会话、登录方式、验证码记录都不存在了。
  const left = await withDatabase(async (client) => {
    const count = async (sql: string, value: string) =>
      Number((await client.query(sql, [value])).rows[0].count);
    return {
      user: await count('select count(*) from "user" where id = $1', oldId!),
      session: await count(
        "select count(*) from session where user_id = $1",
        oldId!,
      ),
      account: await count(
        "select count(*) from account where user_id = $1",
        oldId!,
      ),
      verification: await count(
        "select count(*) from verification where identifier like '%' || $1",
        email,
      ),
    };
  });
  expect(left).toEqual({ user: 0, session: 0, account: 0, verification: 0 });

  // 验证码登录会自动注册：同一邮箱再登录得到的是一个新的空账户。
  await useRandomIp(page);
  await signIn(page, email);
  await expect(page).toHaveURL("/dashboard");
  const newId = await findUserId(email);
  expect(newId).toBeTruthy();
  expect(newId).not.toBe(oldId);
});
