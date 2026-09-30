import { expect, test, type Browser, type Page } from "@playwright/test";

import messages from "../messages/en.json";
import { waitForEmail } from "../src/core/email/testing";
import {
  clearResendCooldown,
  findUserId,
  signIn,
  uniqueEmail,
  useRandomIp,
  withDatabase,
} from "./auth-helpers";

const a = messages.Auth.signIn;
const em = messages.Account.email;
const dv = messages.Account.devices;

test.beforeEach(async ({ page }) => {
  await useRandomIp(page);
});

/**
 * Call an auth endpoint directly and assert HTTP-level success (on failure, the response body goes
 * into the assertion message).
 *
 * Requests with cookies go through Better Auth's CSRF check: `page.request` isn't sent by the
 * browser and has no `Origin` header, so add one explicitly here — otherwise you get
 * MISSING_OR_NULL_ORIGIN.
 */
async function post(
  page: Page,
  path: string,
  data: Record<string, string>,
  origin: string,
) {
  const response = await page.request.post(`/api/auth${path}`, {
    data,
    headers: { origin },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response;
}

/** Read the email-change flow's verification code from the outbox. */
async function changeEmailCode(to: string, since: Date) {
  const mail = await waitForEmail({ to, template: "change-email-code", since });
  return { code: String(mail.props.code), mail };
}

// This case drives the endpoints directly to pin their contract; the settings UI flow is covered
// below. Changing email is security-sensitive: afterwards, every session created before the change
// (including the current one) must be invalidated.
test("after a successful email change old sessions are invalidated immediately and the new email can sign in", async ({
  page,
  baseURL,
}) => {
  const origin = baseURL!;
  const email = uniqueEmail("email-change");
  const newEmail = uniqueEmail("email-changed");

  await signIn(page, email);
  // A new user's first stop after sign-up is onboarding; this case tests session invalidation, so
  // go back to the dashboard before continuing.
  await expect(page).toHaveURL("/onboarding");
  await page.goto("/dashboard");
  const userId = await findUserId(email);
  expect(userId).toBeTruthy();

  // 1) Verification code for the current email (the second step required by
  // changeEmail.verifyCurrentEmail).
  await clearResendCooldown(email);
  const sinceCurrent = new Date(Date.now() - 1000);
  await post(
    page,
    "/email-otp/send-verification-otp",
    { email, type: "email-verification" },
    origin,
  );
  const current = await changeEmailCode(email, sinceCurrent);
  // The email to the current address is "confirm you requested this change".
  expect(current.mail.props.forNewEmail).toBe(false);

  // 2) Exchange it for the new email's verification code (no email is sent at this step if the
  // new address is already taken).
  const sinceChange = new Date(Date.now() - 1000);
  await post(
    page,
    "/email-otp/request-email-change",
    { newEmail, otp: current.code },
    origin,
  );
  const next = await changeEmailCode(newEmail, sinceChange);
  expect(next.mail.props.forNewEmail).toBe(true);
  // The two emails are worded differently so recipients can tell which step they're confirming.
  expect(next.mail.subject).not.toBe(current.mail.subject);

  // 3) Submit the new email's verification code; the email changes to the new address.
  const changed = await post(
    page,
    "/email-otp/change-email",
    { newEmail, otp: next.code },
    origin,
  );
  expect(await changed.json()).toEqual({ success: true });

  // Old session invalidated immediately: the cookie is still in the browser, but it's no longer
  // a valid session.
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByLabel(a.emailLabel)).toBeVisible();

  // Not a single session row is left for the user in the database, the email is the new address,
  // and the old address no longer belongs to any account.
  const left = await withDatabase(async (client) => ({
    sessions: Number(
      (
        await client.query("select count(*) from session where user_id = $1", [
          userId,
        ])
      ).rows[0].count,
    ),
    emails: (
      await client.query<{ email: string }>(
        'select email from "user" where id = $1',
        [userId],
      )
    ).rows,
  }));
  expect(left.sessions).toBe(0);
  expect(left.emails).toEqual([{ email: newEmail }]);
  expect(await findUserId(email)).toBeUndefined();

  // The new email can sign in, and it's the same account.
  // Before this sign-in the browser still holds the invalidated cookie, so /dashboard is sent by
  // the page itself to /sign-in without a callbackURL (the proxy stays out of it when a cookie is
  // present), which is why it still lands on onboarding first.
  await useRandomIp(page);
  await signIn(page, newEmail);
  await expect(page).toHaveURL("/onboarding");
  expect(await findUserId(newEmail)).toBe(userId);
});

/** Count the user's session rows. */
const sessionCount = (userId: string) =>
  withDatabase(async (client) =>
    Number(
      (
        await client.query("select count(*) from session where user_id = $1", [
          userId,
        ])
      ).rows[0].count,
    ),
  );

/**
 * Fill a field and submit until the next step shows up: values typed before hydration are reset by
 * React, and the click must be bounded so a retry still has budget (same reason as requestCode).
 */
async function fillAndSubmit(
  page: Page,
  field: string,
  value: string,
  button: string,
  next: string,
) {
  await expect(async () => {
    await page.getByLabel(field, { exact: true }).fill(value);
    await page
      .getByRole("button", { name: button, exact: true })
      .click({ timeout: 1000 });
    await expect(page.getByLabel(next, { exact: true })).toBeVisible({
      timeout: 2000,
    });
  }).toPass({ timeout: 15_000 });
}

test("changing email from settings signs out every device and the new email signs in", async ({
  page,
}) => {
  const email = uniqueEmail("settings-email");
  const newEmail = uniqueEmail("settings-email-new");
  await signIn(page, email);
  const userId = (await findUserId(email))!;
  await page.goto("/settings");

  // A wrong current-address code is refused and stays in the box.
  await clearResendCooldown(email);
  const sinceCurrent = new Date(Date.now() - 1000);
  await fillAndSubmit(
    page,
    em.newLabel,
    newEmail,
    em.continue,
    em.currentCodeLabel,
  );
  const current = await changeEmailCode(email, sinceCurrent);
  const wrong = current.code === "000000" ? "111111" : "000000";
  await page.getByLabel(em.currentCodeLabel).fill(wrong);
  await page.getByRole("button", { name: em.continue }).click();
  // Scoped to the form: Next's route announcer is also a role="alert".
  const form = page.getByRole("form", { name: em.title });
  await expect(form.getByRole("alert")).toHaveText(
    messages.Auth.errors.invalidCode,
  );
  await expect(page.getByLabel(em.currentCodeLabel)).toHaveValue(wrong);

  const sinceNew = new Date(Date.now() - 1000);
  await page.getByLabel(em.currentCodeLabel).fill(current.code);
  await page.getByRole("button", { name: em.continue }).click();
  await expect(page.getByLabel(em.newCodeLabel)).toBeVisible();
  const next = await changeEmailCode(newEmail, sinceNew);
  await page.getByLabel(em.newCodeLabel).fill(next.code);
  await page.getByRole("button", { name: em.confirm }).click();

  await expect(
    page.getByRole("status").filter({ hasText: newEmail }),
  ).toHaveText(em.done.replace("{email}", newEmail));
  // The page says so, but the database is the evidence: no session is left.
  expect(await sessionCount(userId)).toBe(0);
  expect(await findUserId(newEmail)).toBe(userId);

  await page.getByRole("link", { name: em.signIn }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in/);
});

/** A fresh browser for the same user: another "device". */
async function newDevice(browser: Browser) {
  return (await browser.newContext()).newPage();
}

test("signing out one device ends only that device's session", async ({
  page,
  browser,
}) => {
  const email = uniqueEmail("devices-one");
  await signIn(page, email);
  const userId = (await findUserId(email))!;
  const other = await newDevice(browser);
  await useRandomIp(other);
  await clearResendCooldown(email);
  await signIn(other, email);
  expect(await sessionCount(userId)).toBe(2);

  await page.goto("/settings");
  const rows = page.getByTestId("device-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: dv.current })).toHaveCount(1);
  const otherRow = rows.filter({ hasNotText: dv.current });
  await otherRow.getByRole("button", { name: /^Sign out / }).click();
  await expect(rows).toHaveCount(1);
  expect(await sessionCount(userId)).toBe(1);

  // That device's next request has to sign in again; this one is still in.
  await other.goto("/dashboard");
  await expect(other).toHaveURL(/\/sign-in/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL("/dashboard");
  await other.context().close();
});

test("signing out all other devices keeps this one", async ({
  page,
  browser,
}) => {
  const email = uniqueEmail("devices-all");
  await signIn(page, email);
  const userId = (await findUserId(email))!;
  const second = await newDevice(browser);
  await useRandomIp(second);
  await clearResendCooldown(email);
  await signIn(second, email);
  const third = await newDevice(browser);
  await useRandomIp(third);
  await clearResendCooldown(email);
  await signIn(third, email);
  const others = [second, third];
  expect(await sessionCount(userId)).toBe(3);

  await page.goto("/settings");
  await expect(page.getByTestId("device-row")).toHaveCount(3);
  await page.getByRole("button", { name: dv.signOutOthers }).click();
  const dialog = page.getByRole("alertdialog", { name: dv.othersTitle });
  await dialog.getByRole("button", { name: dv.othersConfirm }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("device-row")).toHaveCount(1);
  await expect(page.getByText(dv.onlyThis)).toBeVisible();
  expect(await sessionCount(userId)).toBe(1);

  for (const other of others) {
    await other.goto("/dashboard");
    await expect(other).toHaveURL(/\/sign-in/);
    await other.context().close();
  }
  await page.reload();
  await expect(page).toHaveURL("/settings");
});
