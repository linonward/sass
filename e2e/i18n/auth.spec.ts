import path from "node:path";

import { expect, test } from "@playwright/test";

import en from "../../messages/en.json";
import { waitForEmail } from "../../src/core/email/testing";
import {
  enterCode,
  requestCode,
  uniqueEmail,
  useRandomIp,
} from "../auth-helpers";
import { i18nCopyDir, pseudoTranslate, TEST_LOCALE } from "./test-locale";

const copy = pseudoTranslate(en);

test("非默认语言下验证码登录：保留语言前缀，邮件使用该语言", async ({
  page,
  baseURL,
}) => {
  await useRandomIp(page);
  const outboxDir = path.join(
    i18nCopyDir(new URL(baseURL!).port),
    ".tmp",
    "emails",
  );
  const email = uniqueEmail("i18n");

  // 未登录访问带前缀的受保护页面，跳到同语言的登录页。
  await page.goto(`/${TEST_LOCALE}/dashboard`);
  await expect(page).toHaveURL(
    `/${TEST_LOCALE}/sign-in?callbackURL=${encodeURIComponent(`/${TEST_LOCALE}/dashboard`)}`,
  );

  const { code, mail } = await requestCode(page, email, { copy, outboxDir });
  expect(mail.locale).toBe(TEST_LOCALE);
  expect(mail.subject.startsWith(`[${TEST_LOCALE}] `)).toBe(true);

  await enterCode(page, code, copy);
  await expect(page).toHaveURL(`/${TEST_LOCALE}/dashboard`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    copy.Dashboard.home.title,
  );

  const welcome = await waitForEmail(
    { to: email, template: "welcome" },
    { dir: outboxDir },
  );
  expect(welcome.locale).toBe(TEST_LOCALE);
});

test("设置偏好语言后界面切换到该语言，并保存到用户资料", async ({
  page,
  baseURL,
}) => {
  await useRandomIp(page);
  const outboxDir = path.join(
    i18nCopyDir(new URL(baseURL!).port),
    ".tmp",
    "emails",
  );
  const email = uniqueEmail("pref");
  const { code } = await requestCode(page, email, { outboxDir });
  await enterCode(page, code);
  await expect(page).toHaveURL("/dashboard");

  await page.goto("/settings");
  const form = page.getByRole("form", { name: en.Account.locale.label });
  await form
    .getByRole("combobox", { name: en.Account.locale.label })
    .selectOption(TEST_LOCALE);
  await form.getByRole("button", { name: en.Account.locale.save }).click();

  await expect(page).toHaveURL(`/${TEST_LOCALE}/settings`);
  await expect(page.locator("html")).toHaveAttribute("lang", TEST_LOCALE);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    copy.Account.title,
  );
  await expect(
    page.getByRole("combobox", { name: copy.Account.locale.label }),
  ).toHaveValue(TEST_LOCALE);
});
