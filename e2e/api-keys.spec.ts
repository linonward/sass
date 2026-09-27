import { expect, test, type Page } from "@playwright/test";

import messages from "../messages/en.json";
import {
  findUserId,
  signIn,
  uniqueEmail,
  useRandomIp,
  withDatabase,
} from "./auth-helpers";

const ak = messages.ApiKeys;

/** 取测试接口的返回体：`GET /api/api-keys/me` 用 key 认出调用用户。 */
async function callWithKey(page: Page, key: string | null) {
  const response = await page.request.get("/api/api-keys/me", {
    headers: key ? { authorization: `Bearer ${key}` } : {},
  });
  return { status: response.status(), body: await response.json() };
}

/** 走一遍界面：新建 key 并取回一次性明文（关掉弹层前它才在页面上）。 */
async function createKey(page: Page, name: string) {
  await page.getByTestId("api-key-create").click();
  const form = page.getByRole("dialog", { name: ak.create.title });
  await form.getByTestId("api-key-name").fill(name);
  await form.getByRole("button", { name: ak.create.submit }).click();

  const created = page.getByRole("dialog", { name: ak.create.createdTitle });
  await expect(created).toBeVisible();
  const plaintext = await created
    .getByTestId("api-key-created-value")
    .inputValue();
  return { created, plaintext };
}

test.beforeEach(async ({ page }) => {
  await useRandomIp(page);
});

test("建 key → 用 key 调接口 → 撤销 → 同一把 key 立刻 401", async ({
  page,
}) => {
  const email = uniqueEmail("api-keys");
  await signIn(page, email);
  await page.goto("/api-keys");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(ak.title);
  await expect(page.getByText(ak.empty)).toBeVisible();

  const name = `Production ${Date.now() % 100000}`;
  const { created, plaintext } = await createKey(page, name);
  // 明文是 sk_ + 64 位 hex，且只在弹层里出现这一次。
  expect(plaintext).toMatch(/^sk_[0-9a-f]{64}$/);
  await expect(created.getByTestId("api-key-created-name")).toHaveText(
    ak.create.createdName.replace("{name}", name),
  );

  // 「复制」真的把明文放进剪贴板（写成功按钮才变成 Copied）。
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await created.getByTestId("api-key-copy").click();
  await expect(created.getByTestId("api-key-copy")).toHaveText(
    ak.create.copied,
  );
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    plaintext,
  );
  await created.getByRole("button", { name: ak.create.done }).click();

  // 列表：只有前缀，没有明文；状态是「有效」。
  const row = page.getByTestId("api-key-row");
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId("api-key-row-name")).toHaveText(name);
  await expect(row.getByTestId("api-key-row-status")).toHaveText(
    ak.status.active,
  );
  await expect(row).toContainText(`${plaintext.slice(0, 11)}…`);
  expect(await page.content()).not.toContain(plaintext);

  // 有效 key：接口认出调用用户（request.apiKey）。
  const userId = await findUserId(email);
  const ok = await callWithKey(page, plaintext);
  expect(ok.status).toBe(200);
  expect(ok.body).toEqual({
    userId,
    keyId: expect.any(String),
    name,
    prefix: plaintext.slice(0, 11),
  });

  // 记使用时间不阻塞响应，但最终会写进库。
  await expect
    .poll(
      () =>
        withDatabase(async (client) => {
          const { rows } = await client.query<{ last_used_at: Date | null }>(
            "select last_used_at from user_api_keys where user_id = $1",
            [userId],
          );
          return rows[0]?.last_used_at ?? null;
        }),
      { timeout: 10_000 },
    )
    .not.toBeNull();
  await page.reload();
  await expect(row).not.toContainText(ak.never);

  // 缺失 / 随机字符串 / 格式对但不存在 → 401。
  expect((await callWithKey(page, null)).status).toBe(401);
  expect(
    (await callWithKey(page, plaintext.split("").reverse().join(""))).status,
  ).toBe(401);
  expect((await callWithKey(page, `sk_${"0".repeat(64)}`)).status).toBe(401);

  // 撤销：确认对话框点名是哪把 key，确认后列表状态变「已撤销」。
  await row.getByTestId("api-key-revoke").click();
  const confirm = page.getByRole("dialog", {
    name: ak.revoke.title.replace("{name}", name),
  });
  await confirm.getByTestId("api-key-revoke-confirm").click();
  await expect(row.getByTestId("api-key-row-status")).toHaveText(
    ak.status.revoked,
  );

  // 撤销后同一把 key 立刻失效（鉴权每次都查库，没有缓存窗口）。
  expect((await callWithKey(page, plaintext)).status).toBe(401);

  // 刷新后仍然在列表里，且不再提供撤销入口。
  await page.reload();
  await expect(row.getByTestId("api-key-row-status")).toHaveText(
    ak.status.revoked,
  );
  await expect(row.getByTestId("api-key-revoke")).toHaveCount(0);
});

test("同名 key 只能有一把：第二次报重名，列表不增加", async ({ page }) => {
  await signIn(page, uniqueEmail("api-keys-duplicate"));
  await page.goto("/api-keys");

  const name = "Shared name";
  const { created } = await createKey(page, name);
  await created.getByRole("button", { name: ak.create.done }).click();
  await expect(page.getByTestId("api-key-row")).toHaveCount(1);

  await page.getByTestId("api-key-create").click();
  const form = page.getByRole("dialog", { name: ak.create.title });
  await form.getByTestId("api-key-name").fill(name);
  await form.getByRole("button", { name: ak.create.submit }).click();
  await expect(form.getByRole("alert")).toHaveText(ak.create.errors.duplicate);
  await form.getByRole("button", { name: ak.create.cancel }).click();

  await expect(page.getByTestId("api-key-row")).toHaveCount(1);
});

// 产品面在 375px 下不横向溢出（亮暗两套）。表格是最容易撑破的一屏，
// 所以先建一把 key 让它渲染出来，再量宽度。
test.describe("375px 宽度", () => {
  test.use({ viewport: { width: 375, height: 740 } });

  for (const theme of ["light", "dark"] as const) {
    test(`${theme} 模式下 API keys 页不横向溢出`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await signIn(page, uniqueEmail(`api-keys-overflow-${theme}`));
      await page.goto("/api-keys");
      const { created } = await createKey(page, "A key with a long-ish name");
      await created.getByRole("button", { name: ak.create.done }).click();
      await expect(page.getByTestId("api-key-row")).toHaveCount(1);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
