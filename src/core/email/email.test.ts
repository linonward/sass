// @vitest-environment node
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { foregroundFor, INK, neutralScale } from "@/core/theme/brand-css";

import en from "../../../messages/en.json";
import siteConfig from "../../../site.config";
import { renderEmail, sendEmail } from "./send";
import { readLatestEmail, waitForEmail } from "./testing";
import { createTransport, type OutgoingEmail } from "./transports";

// Simulate a multi-locale site; the second locale's copy is pseudo-translated from en.json.
vi.mock("@/core/i18n/routing", () => ({
  routing: { locales: ["en", "de"], defaultLocale: "en" },
}));

function pseudo(value: unknown): unknown {
  if (typeof value === "string") return `[de] ${value}`;
  return Object.fromEntries(
    Object.entries(value as object).map(([k, v]) => [k, pseudo(v)]),
  );
}

vi.mock("./translator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./translator")>();
  return {
    ...actual,
    loadMessages: async (locale: string) =>
      locale === "de"
        ? pseudo(en)
        : locale === "en"
          ? en
          : actual.loadMessages(locale),
  };
});

const send = vi.fn();
vi.mock("resend", () => ({
  Resend: vi.fn(function (this: { emails: unknown }, key: string) {
    this.emails = { send: (args: unknown) => send(key, args) };
  }),
}));

// Email templates inline the site name, brand color, and site URL into the HTML. Rendering the
// real config would force buyers to run `pnpm test -u` whenever they change name / brand / domain
// in site.config.ts. So fixed values are used here: the snapshots only lock the template structure
// (colors are still hex, same as a real render), and assertions that need the site name use this
// fixture too. The mapping from the real config to these constants is guarded by the "brand values
// come from site.config.ts" test below.
const brand = vi.hoisted(() => ({
  name: "Fixture",
  siteUrl: "https://example.com",
  primary: "#334155",
  onPrimary: "#ffffff",
  logoUrl: null,
  text: "#171717",
  muted: "#737373",
  border: "#e5e5e5",
  background: "#f5f5f5",
}));

vi.mock("./brand", () => ({ emailBrand: brand }));

const signIn = {
  to: "ada@example.com",
  template: "sign-in-code",
  props: { code: "123456", expiresInMinutes: 5 },
} as const;

describe("renderEmail", () => {
  test("brand values come from site.config.ts", async () => {
    const { emailBrand } =
      await vi.importActual<typeof import("./brand")>("./brand");
    expect(emailBrand.name).toBe(siteConfig.name);
    expect(emailBrand.primary).toBe(siteConfig.brand.primaryColor);
    expect(emailBrand.siteUrl).toBe(`https://${siteConfig.domain}`);
  });

  test("colors are the same values as the site tokens", async () => {
    // Emails can't inline CSS variables, so hex is hard-coded; but "what text color goes on the
    // primary" and "which neutral step" must be the same decision as on the site, or after a buyer
    // changes the brand color the emails stay on a different set of cool grays.
    const { emailBrand } =
      await vi.importActual<typeof import("./brand")>("./brand");
    const neutral = neutralScale(siteConfig.brand.primaryColor);
    expect(emailBrand.onPrimary).toBe(
      foregroundFor(siteConfig.brand.primaryColor),
    );
    expect(emailBrand.text).toBe(INK);
    expect(emailBrand.muted).toBe(neutral.mutedForeground);
    expect(emailBrand.border).toBe(neutral.border);
    expect(emailBrand.background).toBe(neutral.canvas);
  });

  test("produces html, plain text, subject, and sender info", async () => {
    const email = await renderEmail(signIn);
    const { fromName, fromAddress, replyTo } = siteConfig.email;
    expect(email.from).toBe(`${fromName} <${fromAddress}>`);
    expect(email.replyTo).toBe(replyTo);
    expect(email.to).toEqual(["ada@example.com"]);
    expect(email.subject).toBe(`Your ${brand.name} sign-in code`);
    expect(email.html).toContain("123456");
    expect(email.text).toContain("123456");
    expect(email.text).toContain("5 minutes");
    expect(email.html).not.toMatch(/oklch/);
  });

  test("template copy follows the locale", async () => {
    const email = await renderEmail({ ...signIn, locale: "de" });
    expect(email.locale).toBe("de");
    expect(email.subject).toBe(`[de] Your ${brand.name} sign-in code`);
    expect(email.text).toContain("[de] Your sign-in code");
    expect(email.html).toContain('lang="de"');
  });

  test("throws for a locale that is not enabled", async () => {
    await expect(renderEmail({ ...signIn, locale: "fr" })).rejects.toThrow(
      /Unsupported email locale "fr"/,
    );
  });

  test("welcome uses a generic greeting when there is no name", async () => {
    const email = await renderEmail({
      to: "a@b.co",
      template: "welcome",
      props: {},
    });
    expect(email.text).toContain("Hi there,");
  });

  test.each([
    ["sign-in-code", signIn.props],
    [
      "change-email-code",
      { code: "482913", expiresInMinutes: 5, forNewEmail: false },
    ],
    ["welcome", { name: "Ada" }],
    [
      "payment-succeeded",
      {
        planName: "Pro",
        kind: "subscription",
        amount: 1900,
        currency: "USD",
        paidAt: "2026-09-25T12:00:00.000Z",
        renewsAt: "2026-10-25T12:00:00.000Z",
        credits: 2000,
        manageUrl: "https://example.com/billing",
      },
    ],
    [
      "payment-failed",
      {
        planName: "Pro",
        amount: 1900,
        currency: "USD",
        manageUrl: "https://example.com/billing",
      },
    ],
    [
      "subscription-canceled",
      {
        planName: "Pro",
        endsAt: "2026-10-25T12:00:00.000Z",
        manageUrl: "https://example.com/billing",
      },
    ],
    [
      "credits-low",
      {
        balance: 80,
        threshold: 100,
        topUpUrl: "https://example.com/pricing",
      },
    ],
    [
      "status-incident",
      {
        component: "API",
        status: "degraded",
        message: "Elevated error rates on the REST API.",
        resolvedAt: null,
        url: "https://example.com/status",
        withdrawUrl: "https://example.com/status/unsubscribe",
      },
    ],
    [
      "status-subscription",
      { confirmUrl: "https://example.com/status/confirm?token=abc" },
    ],
  ] as const)("%s template snapshot", async (template, props) => {
    const email = await renderEmail({ to: "a@b.co", template, props } as never);
    expect(email.html).toMatchSnapshot("html");
    expect(email.text).toMatchSnapshot("text");
  });
});

describe("change-email verification codes", () => {
  const props = { code: "482913", expiresInMinutes: 5 };

  // Changing the email takes two codes: the one sent to the current address means "confirm you
  // started this change", the one sent to the new address means "confirm this address works". The
  // two emails must be worded differently, or the recipient can't tell which step they're
  // confirming.
  test("current and new address get different subjects and copy", async () => {
    const current = await renderEmail({
      to: "a@b.co",
      template: "change-email-code",
      props: { ...props, forNewEmail: false },
    });
    const next = await renderEmail({
      to: "a@b.co",
      template: "change-email-code",
      props: { ...props, forNewEmail: true },
    });

    expect(current.subject).not.toBe(next.subject);
    expect(current.text).not.toBe(next.text);
    expect(current.text).toContain(props.code);
    expect(next.text).toContain(props.code);
  });
});

describe("billing email templates", () => {
  test("subject, amount, and date follow the locale", async () => {
    const props = {
      planName: "Pro",
      kind: "one_time",
      amount: 19900,
      currency: "USD",
      paidAt: "2026-09-25T12:00:00.000Z",
      manageUrl: "https://example.com/billing",
    } as const;
    const en = await renderEmail({
      to: "a@b.co",
      template: "payment-succeeded",
      props,
    });
    expect(en.subject).toBe(`Payment received for Pro · ${brand.name}`);
    expect(en.text).toContain("$199.00");
    expect(en.text).toContain("September 25, 2026");
    // One-time purchases have no renewal date
    expect(en.text).not.toContain("Renews on");

    const de = await renderEmail({
      to: "a@b.co",
      template: "payment-succeeded",
      props,
      locale: "de",
    });
    expect(de.subject.startsWith("[de] ")).toBe(true);
    expect(de.html).toContain('lang="de"');
    // German date format
    expect(de.text).toContain("25. September 2026");
  });

  test("rows for missing optional fields are hidden", async () => {
    const email = await renderEmail({
      to: "a@b.co",
      template: "payment-failed",
      props: { manageUrl: "https://example.com/billing" },
    });
    expect(email.text).toContain("couldn't process your latest payment");
    expect(email.text).not.toContain("Amount");
  });
});

describe("status email templates", () => {
  const props = {
    component: "API",
    status: "degraded",
    message: "Elevated error rates on the REST API.",
    resolvedAt: null,
    url: "https://example.com/status",
    withdrawUrl: "https://example.com/status/unsubscribe?email=a%40b.co&sig=x",
  } as const;

  test("ongoing and resolved notices have different headings and subjects", async () => {
    const open = await renderEmail({
      to: "a@b.co",
      template: "status-incident",
      props,
    });
    expect(open.subject).toBe("API is having issues");
    expect(open.text).toContain("Elevated error rates");

    const resolved = await renderEmail({
      to: "a@b.co",
      template: "status-incident",
      props: { ...props, resolvedAt: "2026-09-27T12:00:00.000Z" },
    });
    expect(resolved.subject).toBe("API has recovered");
    expect(resolved.subject).not.toBe(open.subject);
    // A resolution notice still carries the level from when it happened; "resolved" shouldn't
    // erase "how bad it just was".
    expect(resolved.text).toContain("Degraded");
  });

  test("notices always include an unsubscribe link", async () => {
    const email = await renderEmail({
      to: "a@b.co",
      template: "status-incident",
      props,
    });
    expect(email.html).toContain(props.withdrawUrl.replace(/&/g, "&amp;"));
  });

  test("confirmation email includes the token link", async () => {
    const email = await renderEmail({
      to: "a@b.co",
      template: "status-subscription",
      props: { confirmUrl: "https://example.com/status/confirm?token=abc" },
    });
    expect(email.subject).toBe(
      `Confirm your ${brand.name} status subscription`,
    );
    expect(email.text).toContain(
      "https://example.com/status/confirm?token=abc",
    );
  });
});

describe("transports", () => {
  let email: OutgoingEmail;
  beforeEach(async () => {
    email = await renderEmail(signIn);
    send.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  test("console: prints recipient, subject, and plain-text body", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const { id } = await createTransport("console")(email);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const output = log.mock.calls.flat().join("\n");
    expect(output).toContain("To:       ada@example.com");
    expect(output).toContain(`Subject:  ${email.subject}`);
    expect(output).toContain("123456");
  });

  test("file: back-to-back writes in the same millisecond keep file names in send order", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "emails-"));
    try {
      const transport = createTransport("file", { outboxDir: dir });
      const ids: string[] = [];
      for (let i = 0; i < 50; i++) {
        const code = String(i).padStart(6, "0");
        ids.push(
          (await transport({ ...email, props: { ...email.props, code } })).id,
        );
      }
      const files = (await readdir(dir)).sort();
      const order = await Promise.all(
        files.map(
          async (f) => JSON.parse(await readFile(path.join(dir, f), "utf8")).id,
        ),
      );
      expect(order).toEqual(ids);
      const latest = await readLatestEmail({ to: "ada@example.com" }, dir);
      expect(latest?.props.code).toBe("000049");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("file: writes JSON that readLatestEmail / waitForEmail can read", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "emails-"));
    try {
      const transport = createTransport("file", { outboxDir: dir });
      const before = new Date();
      await transport({ ...email, to: ["old@example.com"] });
      const { id } = await transport(email);

      const files = await readdir(dir);
      expect(files).toHaveLength(2);
      const stored = JSON.parse(
        await readFile(path.join(dir, files.sort()[1]!), "utf8"),
      );
      expect(stored).toMatchObject({
        id,
        to: ["ada@example.com"],
        subject: email.subject,
        template: "sign-in-code",
        locale: "en",
        props: { code: "123456", expiresInMinutes: 5 },
      });
      expect(new Date(stored.sentAt).getTime()).toBeGreaterThanOrEqual(
        before.getTime(),
      );

      const latest = await readLatestEmail(
        { to: "ada@example.com", template: "sign-in-code" },
        dir,
      );
      expect(latest?.props.code).toBe("123456");
      expect(
        await readLatestEmail({ to: "nobody@example.com" }, dir),
      ).toBeUndefined();
      expect(
        (await waitForEmail({ to: "old@example.com" }, { dir })).id,
      ).not.toBe(id);
      await expect(
        waitForEmail(
          { to: "nobody@example.com" },
          { dir, timeout: 50, interval: 10 },
        ),
      ).rejects.toThrow(/No email matching/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("resend: hands the rendered email to the SDK", async () => {
    send.mockResolvedValue({ data: { id: "email_1" }, error: null });
    const { id } = await createTransport("resend", { resendApiKey: "re_test" })(
      email,
    );
    expect(id).toBe("email_1");
    expect(send).toHaveBeenCalledWith("re_test", {
      from: email.from,
      to: ["ada@example.com"],
      replyTo: email.replyTo,
      subject: email.subject,
      html: email.html,
      text: email.text,
      tags: [{ name: "template", value: "sign-in-code" }],
    });
  });

  test("resend: throws when the SDK returns an error", async () => {
    send.mockResolvedValue({
      data: null,
      error: { name: "validation_error", message: "bad from" },
    });
    await expect(
      createTransport("resend", { resendApiKey: "re_test" })(email),
    ).rejects.toThrow(/Resend failed to send "sign-in-code": bad from/);
  });

  test("resend: throws when the key is missing", () => {
    expect(() => createTransport("resend")).toThrow(/RESEND_API_KEY/);
  });

  test("sendEmail picks the transport from EMAIL_TRANSPORT", async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "console");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    await sendEmail(signIn);
    expect(log.mock.calls.flat().join("\n")).toContain("123456");
    expect(send).not.toHaveBeenCalled();
  });
});
