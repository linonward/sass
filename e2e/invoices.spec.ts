import { expect, test, type Locator, type Page } from "@playwright/test";

import messages from "../messages/en.json";
import { openUserMenu, signIn, uniqueEmail, useRandomIp } from "./auth-helpers";
import { chooseOption } from "./select-helpers";

// 示例业务模块（src/features/invoices/）的端到端流程：登录 → 新建 → 出现在列表 →
// 编辑 → 搜索 → 删除。删除示例时连同这个文件一起删掉。
const inv = messages.Invoices;
const d = messages.Dashboard;

/**
 * 点开一个弹层并等它出现。hydration 完成前点击没有反应，所以点到真的出现为止
 * （同 auth-helpers 的 openUserMenu：循环里每个动作都要有界，一次落空的 click 会把
 * 整段预算耗光，重试就没机会了）。
 */
async function openDialog(trigger: Locator, dialog: Locator) {
  await expect(async () => {
    if (!(await dialog.isVisible())) await trigger.click({ timeout: 1000 });
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  return dialog;
}

/** 从侧边栏进发票页（移动端先展开抽屉）。 */
async function openInvoices(page: Page, isMobile: boolean) {
  if (isMobile) {
    await page.getByRole("button", { name: d.toggleSidebar }).click();
  }
  await page
    .getByRole("list", { name: d.suiteNav })
    .getByRole("link", { name: d.nav.invoices })
    .click();
  await expect(page).toHaveURL("/invoices");
}

/** 走一遍新建弹层，返回那张「已创建」回执（关掉它列表才更新）。 */
async function createInvoice(
  page: Page,
  {
    customer,
    amount = "1250.00",
    status = "draft",
  }: {
    customer: string;
    amount?: string;
    status?: keyof typeof inv.form.status;
  },
) {
  const form = await openDialog(
    page.getByTestId("invoice-create"),
    page.getByRole("dialog", { name: inv.create.title }),
  );
  await form.getByLabel(inv.form.customerLabel).fill(customer);
  await form.getByLabel(inv.form.amountLabel).fill(amount);
  await chooseOption(
    form.getByLabel(inv.form.statusLabel),
    inv.form.status[status],
  );
  await form.getByTestId("invoice-create-submit").click();

  const created = page.getByRole("dialog", { name: inv.create.createdTitle });
  await expect(created).toBeVisible();
  return created;
}

/** 在搜索框里查一个词并等结果回来。 */
async function search(page: Page, query: string) {
  await page.getByTestId("invoice-search").fill(query);
  await page.getByRole("button", { name: inv.searchButton }).click();
  await expect(page).toHaveURL(new RegExp(`/invoices\\?q=${query}`));
}

test.beforeEach(async ({ page }) => {
  await useRandomIp(page);
});

test("未登录访问发票页跳转登录，登录后回到发票页", async ({ page }) => {
  await page.goto("/invoices");
  await expect(page).toHaveURL(/\/sign-in\?callbackURL=%2Finvoices/);
  await signIn(page, uniqueEmail("invoices-callback"));
  await expect(page).toHaveURL("/invoices");
});

test("从侧边栏进入：新建、编辑、搜索、删除", async ({ page, isMobile }) => {
  await signIn(page, uniqueEmail("invoices"));
  await openInvoices(page, isMobile);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(inv.title);
  await expect(page.getByText(inv.empty)).toBeVisible();

  // 新建：回执出现即成功，关掉就能在列表里看到新行。
  const created = await createInvoice(page, { customer: "Acme Inc." });
  await created.getByRole("button", { name: inv.create.done }).click();

  const row = page.getByTestId("invoice-row");
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId("invoice-row-name")).toHaveText("Acme Inc.");
  await expect(row.getByTestId("invoice-row-status")).toHaveText(
    inv.status.draft,
  );
  await expect(row).toContainText("$1,250.00");

  // 编辑：表单带出当前值，保存后列表是新值。
  const edit = await openDialog(
    row.getByTestId("invoice-edit"),
    page.getByRole("dialog", {
      name: inv.edit.title.replace("{name}", "Acme Inc."),
    }),
  );
  await expect(edit.getByLabel(inv.form.amountLabel)).toHaveValue("1250.00");
  await edit.getByLabel(inv.form.customerLabel).fill("Globex");
  await edit.getByLabel(inv.form.amountLabel).fill("10.50");
  await chooseOption(
    edit.getByLabel(inv.form.statusLabel),
    inv.form.status.paid,
  );
  await edit.getByTestId("invoice-edit-submit").click();
  const saved = page.getByRole("dialog", { name: inv.edit.savedTitle });
  await expect(saved).toBeVisible();
  await saved.getByRole("button", { name: inv.edit.done }).click();

  await expect(row.getByTestId("invoice-row-name")).toHaveText("Globex");
  await expect(row.getByTestId("invoice-row-status")).toHaveText(
    inv.status.paid,
  );
  await expect(row).toContainText("$10.50");

  // 搜索：命中只留一行，没命中给一条空提示（不是「还没有发票」）。
  const second = await createInvoice(page, {
    customer: "Initech",
    amount: "0.99",
    status: "sent",
  });
  await second.getByRole("button", { name: inv.create.done }).click();
  await expect(row).toHaveCount(2);

  await search(page, "globex");
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId("invoice-row-name")).toHaveText("Globex");

  await search(page, "nobody");
  await expect(row).toHaveCount(0);
  await expect(page.getByText(inv.noResults)).toBeVisible();

  // 删除：确认弹层点名是哪一张，确认后行消失、空提示回来。
  await page.goto("/invoices");
  await expect(row).toHaveCount(2);
  const initech = row.filter({ hasText: "Initech" });
  const confirm = await openDialog(
    initech.getByTestId("invoice-delete"),
    page.getByRole("alertdialog", {
      name: inv.delete.title.replace("{name}", "Initech"),
    }),
  );
  await confirm.getByTestId("invoice-delete-confirm").click();
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId("invoice-row-name")).toHaveText("Globex");

  const last = row.getByTestId("invoice-delete");
  await openDialog(
    last,
    page.getByRole("alertdialog", {
      name: inv.delete.title.replace("{name}", "Globex"),
    }),
  );
  await page.getByTestId("invoice-delete-confirm").click();
  await expect(row).toHaveCount(0);
  await expect(page.getByText(inv.empty)).toBeVisible();
});

// jsdom never ran React's post-action form reset, so the unit test for this
// passed while real browsers cleared the fields. Lock it in a browser.
test("a rejected create keeps what was typed and marks nothing as saved", async ({
  page,
  isMobile,
}) => {
  await signIn(page, uniqueEmail("invoices-invalid"));
  await openInvoices(page, isMobile);
  const form = await openDialog(
    page.getByTestId("invoice-create"),
    page.getByRole("dialog", { name: inv.create.title }),
  );
  await form.getByLabel(inv.form.customerLabel).fill("Keep Me");
  await form.getByLabel(inv.form.amountLabel).fill("abc");
  await chooseOption(
    form.getByLabel(inv.form.statusLabel),
    inv.form.status.sent,
  );
  await form.getByTestId("invoice-create-submit").click();

  await expect(form.getByRole("alert")).toHaveText(inv.errors.invalid);
  await expect(form.getByLabel(inv.form.customerLabel)).toHaveValue("Keep Me");
  await expect(form.getByLabel(inv.form.amountLabel)).toHaveValue("abc");
  await expect(form.getByLabel(inv.form.statusLabel)).toHaveText(
    inv.form.status.sent,
  );
});

test("越权：别人的发票既看不到也删不掉", async ({ page, isMobile }) => {
  await signIn(page, uniqueEmail("invoices-owner"));
  await page.goto("/invoices");
  const created = await createInvoice(page, { customer: "Owner Only Inc." });
  await created.getByRole("button", { name: inv.create.done }).click();
  await expect(page.getByTestId("invoice-row")).toHaveCount(1);

  // 换一个账号：列表是空的，页面上连客户名都不出现。
  await openUserMenu(page, isMobile);
  await page.getByRole("menuitem", { name: d.userMenu.signOut }).click();
  await expect(page).toHaveURL("/sign-in");
  await signIn(page, uniqueEmail("invoices-other"));
  await page.goto("/invoices");
  await expect(page.getByText(inv.empty)).toBeVisible();
  expect(await page.content()).not.toContain("Owner Only Inc.");
});

// 产品面在 375px 下不横向溢出（亮暗两套）。表格行里有一列操作按钮，最容易撑破，
// 所以先建一张发票让它渲染出来，再量宽度。
test.describe("375px 宽度", () => {
  test.use({ viewport: { width: 375, height: 740 } });

  for (const theme of ["light", "dark"] as const) {
    test(`${theme} 模式下发票页不横向溢出`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await signIn(page, uniqueEmail(`invoices-overflow-${theme}`));
      await page.goto("/invoices");
      const created = await createInvoice(page, {
        customer: "A customer with a rather long name",
        amount: "999999.99",
        status: "sent",
      });
      await created.getByRole("button", { name: inv.create.done }).click();
      await expect(page.getByTestId("invoice-row")).toHaveCount(1);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
