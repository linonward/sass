import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import messages from "../../messages/en.json";
import siteConfig from "../../site.config";
import {
  REFERRAL_COOKIE,
  signContext,
} from "../../src/core/acquisition/tokens";
import { newReferralCode } from "../../src/core/acquisition/referrals/code";
import {
  clearResendCooldown,
  signIn,
  stubGoogleOneTap,
  uniqueEmail,
  // eslint's react-hooks rule treats anything with a use prefix as a React Hook; this isn't one,
  // so alias it to sidestep the rule.
  useRandomIp as randomIp,
  withDatabase,
} from "../auth-helpers";

const t = messages.Referrals;
const invite = t.invite;
const port = Number(process.env.E2E_PORT ?? 3100) + 2;
const baseURL = `http://localhost:${port}`;
// Verification emails are written to the temporary copy's own directory, not this worktree's
// .tmp/emails.
const outboxDir = path.join(
  os.tmpdir(),
  `sass-acquisition-e2e-${port}`,
  ".tmp/emails",
);
/**
 * Close the attribution preferences panel fixed to the bottom of the page. It covers the sign-in
 * form, and unless it's closed "Send code" can never be clicked (Playwright keeps waiting for it to
 * move). This suite doesn't care about attribution, so click Close like a real user would.
 */
async function closeConsent(page: import("@playwright/test").Page) {
  const close = page.getByRole("button", {
    name: messages.Acquisition.close,
    exact: true,
  });
  // The panel opens asynchronously after page load, so wait for it briefly; if it doesn't appear,
  // treat it as never opened.
  await close.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  if (await close.isVisible().catch(() => false)) await close.click();
}

const signInHere = async (
  page: import("@playwright/test").Page,
  email: string,
) => {
  // Land on sign-in first, then close the panel: it opens asynchronously on every page load, so
  // closing it before navigating is wasted.
  if (!page.url().includes("/sign-in")) await page.goto("/sign-in");
  await closeConsent(page);
  await signIn(page, email, { outboxDir });
};

/**
 * Sign in as someone else: clear the previous person's session first — /sign-in sends signed-in
 * users straight back to /dashboard, so the sign-in form would never appear. Also switches to a
 * new IP and clears the email's resend cooldown.
 * Don't use it for sign-ins that must keep the referral context (referral cookie); use signInHere.
 */
async function switchIdentity(
  page: import("@playwright/test").Page,
  email: string,
) {
  await page.context().clearCookies();
  await randomIp(page);
  await clearResendCooldown(email);
  await signInHere(page, email);
}

/** Existing referral relationships for the invitee; normally at most one. */
async function relationships(inviteeEmail: string) {
  return withDatabase(
    async (db) =>
      (
        await db.query<{ code: string; status: string; inviter: string }>(
          `select r.code, r.status, i.email as inviter
             from referral_relationships r
             join "user" u on u.id = r.invitee_user_id
             join "user" i on i.id = r.inviter_user_id
            where u.email = $1`,
          [inviteeEmail],
        )
      ).rows,
  );
}

/**
 * Page width assertion: wait for content before measuring, so a render failure can't pass falsely.
 */
async function expectNoOverflow(page: import("@playwright/test").Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

/** Pick one branch of an ICU plural message (e2e only runs English, so this is enough). */
function plural(message: string, branch: string, count: number) {
  return message
    .split(`${branch} {`)[1]!
    .split("}")[0]!
    .replace("#", String(count));
}

test.beforeEach(async ({ page }) => {
  await randomIp(page);
  await stubGoogleOneTap(page);
});

test("copy link → invitee sees the terms before sign-up → after accepting, bound exactly once across the sign-in redirect", async ({
  page,
}) => {
  const inviterEmail = uniqueEmail("referral-inviter");
  const inviteeEmail = uniqueEmail("referral-invitee");

  // The inviter gets their personal link on /referrals and copies it.
  await signInHere(page, inviterEmail);
  await page.goto("/referrals");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.title);
  const code = (await page.getByTestId("referral-code").textContent())!.trim();
  expect(code).toMatch(/^[0-9a-hjkmnp-tv-z]{12}$/);
  const link = await page.getByTestId("referral-link").inputValue();
  // The link is the site's own absolute URL (same helper as sitemap/OG), not the current request's
  // host.
  expect(link).toBe(`https://${siteConfig.domain}/invite/${code}`);
  // No relationship exists under the invitee on the page; the referral history is in its empty
  // state.
  await expect(page.getByText(t.notInvitedTitle)).toBeVisible();
  await expect(page.getByText(t.invitedEmpty)).toBeVisible();
  await expectNoOverflow(page);

  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await closeConsent(page);
  await page.getByTestId("referral-copy").click();
  await expect(page.getByTestId("referral-copy")).toHaveAttribute(
    "data-state",
    "copied",
  );
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);

  // Switch to the invitee's browser: before accepting they must see the invitation notice and
  // terms, and nothing is written yet. Accounts created via verification code have no display
  // name, so set one here, which also pins the "inviter's name appears on the invite page" branch.
  await withDatabase((db) =>
    db.query('update "user" set name = $1 where email = $2', [
      "Inviter Name",
      inviterEmail,
    ]),
  );
  await page.context().clearCookies();
  await page.goto(`/invite/${code}`);
  await expect(page.getByTestId("invite-title")).toHaveText(
    invite.fromTitle.replace("{name}", "Inviter Name"),
  );
  await expect(page.getByText(invite.rewardsOff)).toBeVisible();
  await expect(page.getByText(invite.termsVoluntary)).toBeVisible();
  await expect(page.getByText(invite.termsIdentity)).toBeVisible();
  expect(
    (await page.context().cookies()).some(
      (cookie) => cookie.name === REFERRAL_COOKIE,
    ),
  ).toBe(false);
  await expectNoOverflow(page);

  await closeConsent(page);
  await page.getByTestId("referral-accept").click();
  await expect(page.getByTestId("invite-title")).toHaveText(
    invite.acceptedTitle,
  );
  const referralCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === REFERRAL_COOKIE,
  )!;
  expect(referralCookie).toMatchObject({ httpOnly: true, sameSite: "Lax" });
  // The referral context holds only the code, not an email.
  expect(
    Buffer.from(referralCookie.value.split(".")[0]!, "base64url").toString(),
  ).not.toContain(inviteeEmail);

  // After accepting, sign up across the sign-in redirect: bound at sign-up, landing back on
  // /referrals showing them as the invitee.
  await page.getByRole("link", { name: invite.acceptedCta }).click();
  // Wait for the CTA to take the browser to sign-in with a callbackURL; don't let the wrapper
  // redirect away first.
  await page.waitForURL((url) => url.pathname.endsWith("/sign-in"));
  await signInHere(page, inviteeEmail);
  await expect(page).toHaveURL("/referrals");
  await expect(page.getByText(t.invitedByTitle)).toBeVisible();
  await expect(
    page.getByText(
      t.invitedByDescription.replace("{status}", t.status.awaiting_payment),
    ),
  ).toBeVisible();
  expect(await relationships(inviteeEmail)).toEqual([
    { code, status: "awaiting_payment", inviter: inviterEmail },
  ]);
  // Revisiting the invite page doesn't bind again: there's still just one relationship.
  await page.goto(`/invite/${code}`);
  await expect(page.getByTestId("invite-title")).toHaveText(invite.boundTitle);
  await page.goto("/referrals");
  expect(await relationships(inviteeEmail)).toHaveLength(1);

  // The inviter only sees status and time, not the invitee's identity.
  await switchIdentity(page, inviterEmail);
  await page.goto("/referrals");
  const invited = page.getByTestId("referral-invited");
  await expect(invited.getByRole("listitem")).toHaveCount(1);
  await expect(page.getByTestId("referral-invited-status")).toHaveText(
    t.status.awaiting_payment,
  );
  await expect(page.getByText(t.invitedEmpty)).toHaveCount(0);
  const html = await page.content();
  expect(html).not.toContain(inviteeEmail);
  expect(html).not.toContain(inviteeEmail.split("@")[0]!);
});

test("declining an invitation writes no context, and later sign-up works as usual", async ({
  page,
}) => {
  const inviterEmail = uniqueEmail("referral-declined-by");
  const inviteeEmail = uniqueEmail("referral-decliner");

  await signInHere(page, inviterEmail);
  await page.goto("/referrals");
  const code = (await page.getByTestId("referral-code").textContent())!.trim();

  await page.context().clearCookies();
  await page.goto(`/invite/${code}`);
  await closeConsent(page);
  await page.getByTestId("referral-decline").click();
  // Declining shows a clear confirmation, and the context really is cleared.
  await expect(page.getByText(invite.declined)).toBeVisible();
  await expect(page.getByTestId("referral-decline")).toHaveCount(0);
  expect(
    (await page.context().cookies()).some(
      (cookie) => cookie.name === REFERRAL_COOKIE,
    ),
  ).toBe(false);

  // After declining, sign-up works as usual, just without a referral relationship.
  await switchIdentity(page, inviteeEmail);
  await page.goto("/referrals");
  await expect(page.getByText(t.notInvitedTitle)).toBeVisible();
  await expect(page.getByText(t.invitedEmpty)).toBeVisible();
  expect(await relationships(inviteeEmail)).toEqual([]);
});

test("with one invitation already accepted, a second only offers clearing, not an accept button that would fail silently", async ({
  page,
}) => {
  const firstInviter = uniqueEmail("referral-first-by");
  const secondInviter = uniqueEmail("referral-second-by");

  const codeOf = async (email: string) => {
    await switchIdentity(page, email);
    await page.goto("/referrals");
    return (await page.getByTestId("referral-code").textContent())!.trim();
  };
  const first = await codeOf(firstInviter);
  const second = await codeOf(secondInviter);

  // A new visitor accepts the first invitation.
  await page.context().clearCookies();
  await page.goto(`/invite/${first}`);
  await closeConsent(page);
  await page.getByTestId("referral-accept").click();
  await expect(page.getByTestId("invite-title")).toHaveText(
    invite.acceptedTitle,
  );

  // Then opens the second: it explains the first is still in effect and shows no accept button
  // (the server wouldn't switch, and clicking would give no feedback).
  await page.goto(`/invite/${second}`);
  await expect(page.getByTestId("invite-title")).toHaveText(invite.otherTitle);
  await expect(page.getByText(invite.otherBody)).toBeVisible();
  await expect(page.getByTestId("referral-accept")).toHaveCount(0);

  // Clear first as the page says: a confirmation shows, and the page returns to a state where this
  // one can be accepted.
  await closeConsent(page);
  await page.getByTestId("referral-decline").click();
  await expect(page.getByText(invite.cleared)).toBeVisible();
  await expect(page.getByTestId("referral-accept")).toBeVisible();

  // Accepting this one now really accepts it: the code in the context becomes the second one.
  await page.getByTestId("referral-accept").click();
  await expect(page.getByTestId("invite-title")).toHaveText(
    invite.acceptedTitle,
  );
  const cookie = (await page.context().cookies()).find(
    (item) => item.name === REFERRAL_COOKIE,
  )!;
  const context = JSON.parse(
    Buffer.from(cookie.value.split(".")[0]!, "base64url").toString(),
  ) as { code: string };
  expect(context.code).toBe(second);
});

test("with more than a page of referrals, the count is the real total and the list notes it shows only the latest batch", async ({
  page,
}) => {
  const inviterEmail = uniqueEmail("referral-many");
  const seedPrefix = `referral-seeded-${Date.now()}-`;

  await signInHere(page, inviterEmail);
  await page.goto("/referrals");
  const code = (await page.getByTestId("referral-code").textContent())!.trim();
  const invited = page.getByTestId("referral-invited");
  const inviterId = (await withDatabase(async (db) => {
    const { rows } = await db.query<{ id: string }>(
      'select id from "user" where email = $1',
      [inviterEmail],
    );
    return rows[0]?.id ?? null;
  }))!;

  // Seed 51 relationships directly: signing up 51 accounts is too slow, and what's being verified
  // here is how the page shows existing data. Lower numbers are seeded later, so the one cut off
  // should be the oldest (number 51).
  await withDatabase(async (db) => {
    await db.query(
      `insert into "user" (id, name, email, email_verified, created_at)
       select gen_random_uuid()::text, 'Seeded', $1 || g || '@example.test', true, now()
         from generate_series(1, 51) g`,
      [seedPrefix],
    );
    await db.query(
      `insert into referral_relationships
         (invitee_user_id, inviter_user_id, code, status, created_at)
       select u.id, $1, $2, 'awaiting_payment', now() - (g || ' minutes')::interval
         from generate_series(1, 51) g
         join "user" u on u.email = $3 || g || '@example.test'`,
      [inviterId, code, seedPrefix],
    );
  });

  try {
    await page.reload();
    await expect(invited.getByRole("listitem")).toHaveCount(50);
    // The count is 51 but the list has only 50 — the note spells out the difference so nobody thinks
    // one is missing.
    await expect(
      page.getByText(plural(t.invitedCount, "other", 51)),
    ).toBeVisible();
    await expect(
      page.getByText(t.invitedShown.replace("{shown}", "50")),
    ).toBeVisible();
  } finally {
    await withDatabase((db) =>
      db.query('delete from "user" where email like $1', [`${seedPrefix}%`]),
    );
  }
});

test("an expired referral context is ignored at sign-up", async ({ page }) => {
  const inviterEmail = uniqueEmail("referral-expired-by");
  const inviteeEmail = uniqueEmail("referral-expired");

  await signInHere(page, inviterEmail);
  await page.goto("/referrals");
  const code = (await page.getByTestId("referral-code").textContent())!.trim();

  // An invitation accepted 31 days ago: valid signature, valid code, only the window has expired.
  await page.context().clearCookies();
  await page.context().addCookies([
    {
      name: REFERRAL_COOKIE,
      value: signContext(
        {
          v: 1,
          purpose: "referral",
          code,
          acceptedAt: Date.now() - 31 * 24 * 60 * 60 * 1000,
        },
        process.env.BETTER_AUTH_SECRET!,
      ),
      url: baseURL,
      httpOnly: true,
    },
  ]);
  await page.goto(`/invite/${code}`);
  await expect(page.getByTestId("invite-title")).toHaveText(
    invite.genericTitle,
  );

  await signInHere(page, inviteeEmail);
  await page.goto("/referrals");
  await expect(page.getByText(t.notInvitedTitle)).toBeVisible();
  expect(await relationships(inviteeEmail)).toEqual([]);
});

test("neither invalid links nor self-referrals create a relationship", async ({
  page,
}) => {
  const inviterEmail = uniqueEmail("referral-self");
  const strangerEmail = uniqueEmail("referral-stranger");

  // A well-formed code nobody owns: only says the link is invalid, with no hint about ownership.
  await page.goto(`/invite/${newReferralCode()}`);
  await expect(page.getByTestId("invite-title")).toHaveText(
    invite.invalidTitle,
  );
  await expect(page.getByTestId("referral-accept")).toHaveCount(0);

  await signInHere(page, inviterEmail);
  await page.goto("/referrals");
  const code = (await page.getByTestId("referral-code").textContent())!.trim();

  // Self-referral: the link works, but the page shows no accept button.
  await page.goto(`/invite/${code}`);
  await expect(page.getByTestId("invite-title")).toHaveText(invite.selfTitle);
  await expect(page.getByTestId("referral-accept")).toHaveCount(0);
  expect(await relationships(inviterEmail)).toEqual([]);

  // Existing account: referrals are only recorded at account creation, so existing accounts can't
  // get one.
  await switchIdentity(page, strangerEmail);
  await page.goto(`/invite/${code}`);
  await expect(page.getByTestId("invite-title")).toHaveText(
    invite.signedInTitle,
  );
  await expect(page.getByTestId("referral-accept")).toHaveCount(0);
  await page.goto("/referrals");
  await expect(page.getByText(t.notInvitedTitle)).toBeVisible();
  expect(await relationships(strangerEmail)).toEqual([]);
});
