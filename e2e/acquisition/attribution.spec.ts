import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import messages from "../../messages/en.json";
import {
  signIn,
  stubGoogleOneTap,
  uniqueEmail,
  useRandomIp,
  withDatabase,
} from "../auth-helpers";

const t = messages.Acquisition;
const port = Number(process.env.E2E_PORT ?? 3100) + 2;
const outboxDir = path.join(
  os.tmpdir(),
  `sass-acquisition-e2e-${port}`,
  ".tmp/emails",
);
async function source(email: string) {
  return withDatabase(
    async (db) =>
      (
        await db.query<{ snapshot: { source: string } | null }>(
          'select a.snapshot from user_attribution a join "user" u on u.id = a.user_id where u.email = $1',
          [email],
        )
      ).rows[0],
  );
}

test.beforeEach(async ({ page }) => {
  await useRandomIp(page);
  await stubGoogleOneTap(page);
});
test("accept → direct return → registration → withdraw clears linked source", async ({
  page,
}, info) => {
  const errors: string[] = [];
  const consoleIssues: string[] = [];
  page.on("console", (message) => {
    if (["warning", "error"].includes(message.type()))
      consoleIssues.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  const email = uniqueEmail("attribution");
  await page.goto(
    "/?utm_source=launch&utm_campaign=first&email=never-store-this",
  );
  await expect(page).toHaveTitle(/.+/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: t.title })).toBeVisible();
  expect(
    (await page.context().cookies()).some((c) =>
      c.name.startsWith("acquisition_"),
    ),
  ).toBe(false);
  await page.screenshot({
    path: path.join(os.tmpdir(), `${info.project.name}-consent.png`),
  });
  await page.getByRole("button", { name: t.accept, exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: t.saved }),
  ).toBeVisible();
  const cookie = (await page.context().cookies()).find(
    (c) => c.name === "acquisition_source",
  )!;
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax" });
  expect(
    Buffer.from(cookie.value.split(".")[0]!, "base64url").toString(),
  ).not.toContain("never-store-this");
  await page.goto("/");
  await signIn(page, email, { outboxDir });
  await expect
    .poll(() => source(email))
    .toMatchObject({ snapshot: { source: "launch" } });
  await page.getByRole("button", { name: t.preferences, exact: true }).click();
  await page.getByRole("button", { name: t.withdraw, exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: t.removed }),
  ).toBeVisible();
  await expect.poll(() => source(email)).toMatchObject({ snapshot: null });
  expect(
    (await page.context().cookies()).some((c) =>
      c.name.startsWith("acquisition_"),
    ),
  ).toBe(false);
  // Even with a new accepted campaign, existing users cannot get a new source.
  await page.goto("/?utm_source=second");
  await page.getByRole("button", { name: t.preferences, exact: true }).click();
  await page.getByRole("button", { name: t.accept, exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: t.saved }),
  ).toBeVisible();
  expect((await source(email))?.snapshot).toBeNull();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  fs.writeFileSync(
    path.join(os.tmpdir(), `${info.project.name}-console.json`),
    JSON.stringify(consoleIssues, null, 2),
  );
});

test("decline → registration keeps unknown; preferences accessible at 375px", async ({
  page,
}, info) => {
  const email = uniqueEmail("attribution-decline");
  await page.goto("/?utm_source=ignored");
  await page.getByRole("button", { name: t.reject, exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: t.removed }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: t.title })).toHaveCount(0);
  await signIn(page, email, { outboxDir });
  expect(await source(email)).toBeUndefined();
  await page.getByRole("button", { name: t.preferences, exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: t.title })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: path.join(os.tmpdir(), `${info.project.name}-preferences.png`),
  });
});
