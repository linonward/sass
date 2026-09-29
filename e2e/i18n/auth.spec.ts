import path from "node:path";

import { expect, test } from "@playwright/test";

import en from "../../messages/en.json";
import { waitForEmail } from "../../src/core/email/testing";
import {
  enterCode,
  requestCode,
  stubGoogleOneTap,
  uniqueEmail,
  useRandomIp,
} from "../auth-helpers";
import { chooseOption } from "../select-helpers";
import { i18nCopyDir, pseudoTranslate, TEST_LOCALE } from "./test-locale";

/** How the locale select labels a language (same as `nativeName` in the locale switcher). */
const nativeName = (locale: string) =>
  new Intl.DisplayNames([locale], { type: "language" }).of(locale) ?? locale;

const copy = pseudoTranslate(en);

test("verification-code sign-in in a non-default locale keeps the locale prefix and sends the email in that locale", async ({
  page,
  baseURL,
}) => {
  await useRandomIp(page);
  // This copy also reads .env.local, so the sign-in page loads the GIS script; this file only
  // cares about the verification-code flow.
  await stubGoogleOneTap(page);
  const outboxDir = path.join(
    i18nCopyDir(new URL(baseURL!).port),
    ".tmp",
    "emails",
  );
  const email = uniqueEmail("i18n");

  // A signed-out visit to a prefixed protected page redirects to sign-in in the same locale.
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

test("setting a preferred locale switches the UI to it and saves it to the user profile", async ({
  page,
  baseURL,
}) => {
  await useRandomIp(page);
  // This copy also reads .env.local, so the sign-in page loads the GIS script; this file only
  // cares about the verification-code flow.
  await stubGoogleOneTap(page);
  const outboxDir = path.join(
    i18nCopyDir(new URL(baseURL!).port),
    ".tmp",
    "emails",
  );
  const email = uniqueEmail("pref");
  const { code } = await requestCode(page, email, { outboxDir });
  await enterCode(page, code);
  // New users land on onboarding first; this case tests the preferred locale, so go straight to
  // settings.
  await expect(page).toHaveURL("/onboarding");
  await page.goto("/settings");
  const form = page.getByRole("form", { name: en.Account.locale.label });
  await chooseOption(
    form.getByRole("combobox", { name: en.Account.locale.label }),
    nativeName(TEST_LOCALE),
  );
  await form.getByRole("button", { name: en.Account.locale.save }).click();

  await expect(page).toHaveURL(`/${TEST_LOCALE}/settings`);
  await expect(page.locator("html")).toHaveAttribute("lang", TEST_LOCALE);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    copy.Account.title,
  );
  await expect(
    page.getByRole("combobox", { name: copy.Account.locale.label }),
  ).toHaveText(nativeName(TEST_LOCALE));
});
