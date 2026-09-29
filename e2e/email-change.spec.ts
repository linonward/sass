import { expect, test, type Page } from "@playwright/test";

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

// The email-change endpoint currently has no entry point in settings (see the session
// invalidation decision in docs/plan.md), so this calls the endpoint directly. Changing email is
// security-sensitive: afterwards, every session created before the change (including the current
// one) must be invalidated.
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
