import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import messages from "../../messages/en.json";
import { waitForEmail } from "../../src/core/email/testing";
import {
  findUserId,
  signIn,
  stubGoogleOneTap,
  uniqueEmail,
  useRandomIp,
  withDatabase,
} from "../auth-helpers";
const t = messages.Leads;
const outboxDir = path.join(
  os.tmpdir(),
  `sass-acquisition-e2e-${Number(process.env.E2E_PORT ?? 3100) + 2}`,
  ".tmp/emails",
);
const localLink = (raw: unknown) => {
  const url = new URL(String(raw));
  return url.pathname + url.hash;
};
const lead = (email: string) =>
  withDatabase(
    async (db) =>
      (
        await db.query("select * from acquisition_leads where email=$1", [
          email,
        ])
      ).rows[0],
  );
async function submit(page: Page, email: string) {
  const since = new Date(Date.now() - 1000);
  await expect(async () => {
    await page.getByLabel(t.email, { exact: true }).fill(email);
    await page
      .getByRole("checkbox", { name: t.lists.waitlist.consent })
      .check();
    await page.getByRole("button", { name: t.submit, exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: t.sent }),
    ).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
  return waitForEmail(
    { to: email, template: "lead-confirmation", since },
    { dir: outboxDir },
  );
}
test.beforeEach(async ({ page }) => {
  await useRandomIp(page);
  await stubGoogleOneTap(page);
});
test("explicit lead consent → email confirmation → verified registration → withdrawal", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const email = uniqueEmail("lead");
  await page.goto("/waitlist?utm_source=lead-launch");
  await page
    .getByRole("button", { name: messages.Acquisition.accept, exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: messages.Acquisition.saved }),
  ).toBeVisible();
  expect(
    await page
      .getByRole("checkbox", { name: t.lists.waitlist.consent })
      .isChecked(),
  ).toBe(false);
  const mail = await submit(page, email);
  const pending = await lead(email);
  expect(pending.status).toBe("pending");
  expect(await findUserId(email)).toBeUndefined();
  expect(pending.consent_text).toBe(t.lists.waitlist.consent);
  expect(pending.snapshot.source).toBe("lead-launch");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: path.join(os.tmpdir(), `${info.project.name}-lead-form.png`),
  });
  await page.goto(localLink(mail.props.confirmUrl));
  expect((await lead(email)).status).toBe("pending");
  await page
    .getByRole("button", { name: t.confirm.button, exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: t.confirm.done }),
  ).toBeVisible();
  expect((await lead(email)).status).toBe("confirmed");
  // A later direct visit without the source cookie inherits the confirmed lead.
  await page.context().clearCookies({ name: "acquisition_source" });
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: messages.Acquisition.close, exact: true })
    .click();
  await signIn(page, email, { outboxDir });
  await expect
    .poll(async () => Boolean((await lead(email)).user_id))
    .toBe(true);
  const source = await withDatabase(
    async (db) =>
      (
        await db.query(
          "select snapshot,lead_id from user_attribution where user_id=$1",
          [(await lead(email)).user_id],
        )
      ).rows[0],
  );
  expect(source).toMatchObject({
    lead_id: pending.id,
    snapshot: { source: "lead-launch" },
  });
  await page.goto(localLink(mail.props.withdrawUrl));
  expect((await lead(email)).status).toBe("confirmed");
  await page
    .getByRole("button", { name: t.withdraw.button, exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: t.withdraw.done }),
  ).toBeVisible();
  const cleared = await withDatabase(
    async (db) =>
      (
        await db.query("select * from acquisition_leads where id=$1", [
          pending.id,
        ])
      ).rows[0],
  );
  expect(cleared).toMatchObject({
    status: "withdrawn",
    email: null,
    consent_text: null,
    snapshot: null,
    user_id: null,
    confirm_hash: null,
    withdraw_hash: null,
  });
  const attribution = await withDatabase(
    async (db) =>
      (
        await db.query(
          'select a.snapshot from user_attribution a join "user" u on u.id=a.user_id where u.email=$1',
          [email],
        )
      ).rows[0],
  );
  expect(attribution.snapshot).toBeNull();
  expect(errors).toEqual([]);
});
test("declining source after confirming lead prevents inherited attribution", async ({
  page,
}) => {
  const email = uniqueEmail("lead-decline");
  await page.goto("/waitlist?utm_source=discard");
  await page
    .getByRole("button", { name: messages.Acquisition.accept, exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: messages.Acquisition.saved }),
  ).toBeVisible();
  const mail = await submit(page, email);
  await page.goto(localLink(mail.props.confirmUrl));
  await page
    .getByRole("button", { name: t.confirm.button, exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: t.confirm.done }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: messages.Acquisition.preferences,
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: messages.Acquisition.withdraw, exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: messages.Acquisition.removed }),
  ).toBeVisible();
  await signIn(page, email, { outboxDir });
  expect((await lead(email)).user_id).toBeTruthy();
  const result = await withDatabase(
    async (db) =>
      (
        await db.query(
          'select a.snapshot from user_attribution a join "user" u on u.id=a.user_id where u.email=$1',
          [email],
        )
      ).rows,
  );
  expect(result).toEqual([]);
});
