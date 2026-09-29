// @vitest-environment node
// t3-env only validates server variables on the server: importing this module under jsdom counts as
// the client, and reading env.ADMIN_EMAILS throws right away (see src/core/env.ts). So this runs in
// node, like env.test.ts.
import { APIError } from "better-auth/api";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";

import { env } from "@/core/env";
import { routing } from "@/core/i18n/routing";

import siteConfig from "../../../site.config";
import { notificationOutbox } from "@/core/email/queue";
import { cooldownIdentifier } from "./cooldown";
import { googleCredentials, resolveAuthBaseURL } from "./env";
import { EMAIL_SEND_FAILED } from "./errors";
import { auth } from "./server";

/**
 * Every collaborator is replaced with a mock: no database, no emails, no request scope. Assertions
 * target only the parts server.ts writes itself (plugin wiring, the verification code callback, and
 * the two databaseHooks).
 *
 * The factories' return values are fixed inside vi.hoisted because server.ts calls them at import
 * time (things like createAttributionStore(db).freeze), earlier than any beforeEach.
 */
const mocks = vi.hoisted(() => {
  const sendEmail = vi.fn();
  const registerAttribution = vi.fn();
  const bindReferral = vi.fn();
  const linkRegistration = vi.fn();
  const bind = vi.fn();
  const freeze = vi.fn();
  const loggerWarn = vi.fn();
  const loggerError = vi.fn();
  const trackServer = vi.fn();
  /** Tasks passed to runAfterResponse; tests drain them manually to simulate "after the response". */
  const queued: (() => Promise<void> | void)[] = [];

  return {
    sendEmail,
    registerAttribution,
    bindReferral,
    linkRegistration,
    bind,
    freeze,
    loggerWarn,
    loggerError,
    trackServer,
    queued,
    createRegistrationAttribution: vi.fn(() => registerAttribution),
    createReferralBinding: vi.fn(() => bindReferral),
    createLeadService: vi.fn(() => ({ linkRegistration })),
    createReferralService: vi.fn(() => ({ bind })),
    createAttributionStore: vi.fn(() => ({ freeze })),
  };
});

vi.mock("@/core/email", () => ({ sendEmail: mocks.sendEmail }));
// Verification codes go through the outbox: here it's an in-memory version whose deliver calls
// sendEmail directly (like the real outbox's immediate send attempt) and returns "retry" when the
// send fails (the row stays in the database for a resend). For the outbox's own behavior, see
// src/core/email/outbox.test.ts.
vi.mock("@/core/email/queue", () => {
  const rows = new Map<string, Record<string, unknown>>();
  return {
    notificationOutbox: {
      enqueue: vi.fn(async (_db: unknown, input: Record<string, unknown>) => {
        const id = `row-${rows.size + 1}`;
        rows.set(id, input);
        return id;
      }),
      deliver: vi.fn(async (id: string) => {
        const row = rows.get(id)!;
        try {
          await mocks.sendEmail({
            to: row.to,
            template: row.template,
            props: row.props,
            locale: row.locale,
          });
          return "sent";
        } catch {
          return "retry";
        }
      }),
    },
  };
});

// Don't actually call next/server's after (tests aren't in a request scope); just queue the tasks,
// so we can verify that emails are sent after the response rather than synchronously during sign-up.
vi.mock("@/core/lib/after-response", () => ({
  runAfterResponse: (task: () => Promise<void> | void) => {
    mocks.queued.push(task);
    return Promise.resolve();
  },
}));

vi.mock("@/core/observability/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  },
}));

vi.mock("@/core/observability/track-server", () => ({
  trackServer: mocks.trackServer,
}));

vi.mock("@/core/db", () => ({ db: {} }));

vi.mock("@/core/acquisition/registration", () => ({
  createRegistrationAttribution: mocks.createRegistrationAttribution,
}));

vi.mock("@/core/acquisition/referrals/binding", () => ({
  createReferralBinding: mocks.createReferralBinding,
}));

vi.mock("@/core/acquisition/leads/service", () => ({
  createLeadService: mocks.createLeadService,
}));

vi.mock("@/core/acquisition/referrals/service", () => ({
  createReferralService: mocks.createReferralService,
}));

vi.mock("@/core/acquisition/store", () => ({
  createAttributionStore: mocks.createAttributionStore,
}));

// The demo site config has leads / attribution off, so those two branches would never run. Turn on
// just the three acquisition flags here (keeping every other field as-is) so the matching branches
// in the hooks are reachable.
vi.mock("../../../site.config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../site.config")>();
  return {
    default: {
      ...actual.default,
      acquisition: {
        ...actual.default.acquisition,
        attribution: { enabled: true },
        leads: { enabled: true },
        referrals: {
          ...actual.default.acquisition.referrals,
          enabled: true,
        },
      },
    },
  };
});

type PluginLike = {
  id: string;
  options?: Record<string, unknown>;
  hooks?: unknown;
};

type ServerOptions = {
  baseURL: unknown;
  secret: string;
  socialProviders?: { google?: Record<string, unknown> };
  account: { accountLinking: { enabled: boolean; trustedProviders: string[] } };
  rateLimit: { customRules: Record<string, { window: number; max: number }> };
  user: {
    additionalFields: {
      locale: {
        validator: {
          input: { safeParse: (value: unknown) => { success: boolean } };
        };
      };
    };
  };
  plugins: PluginLike[];
  databaseHooks: {
    session: { create: { after: UnknownHook } };
    user: { create: { after: UnknownHook } };
  };
};

/** Hook argument types come from better-auth; tests don't need them exact, so call with unknown. */
type UnknownHook = (value: unknown, ctx: unknown) => Promise<void>;

const ADMIN_EMAIL = "admin@example.com";
const hasGoogle = Boolean(googleCredentials(process.env));
/**
 * A non-default locale, used to verify that the email language follows the request; the site has at
 * least one locale configured (guaranteed by the schema).
 */
const secondLocale = routing.locales[1] ?? routing.locales[0] ?? "en";

function optionsOf(instance: unknown): ServerOptions {
  return (instance as { options: ServerOptions }).options;
}

function pluginIds(options: ServerOptions): string[] {
  return options.plugins.map((plugin) => plugin.id);
}

function plugin(options: ServerOptions, id: string): PluginLike {
  const found = options.plugins.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`plugin ${id} is not registered`);
  return found;
}

/** A plugin's before-hook: matcher decides whether it applies, handler holds the actual logic. */
type BeforeHook = {
  matcher: (context: { path: string }) => boolean;
  handler: (ctx: unknown) => Promise<unknown>;
};

function beforeHook(options: ServerOptions, id: string): BeforeHook {
  const hooks = plugin(options, id).hooks as { before: BeforeHook[] };
  const [first] = hooks.before;
  if (!first) throw new Error(`plugin ${id} has no before hook`);
  return first;
}

/**
 * Import after resetModules so stubbed environment variables make it into the module-level
 * constants of env / server.
 */
async function freshAuth() {
  vi.resetModules();
  const { auth: instance } = await import("./server");
  return optionsOf(instance);
}

async function importHooks() {
  const options = await freshAuth();
  return {
    sessionAfter: options.databaseHooks.session.create.after,
    userAfter: options.databaseHooks.user.create.after,
  };
}

function createCtx({
  headers,
  user,
}: { headers?: Headers; user?: unknown } = {}) {
  const findUserById = vi.fn(async () => user ?? null);
  const updateUser = vi.fn(async () => undefined);
  return {
    headers,
    context: { internalAdapter: { findUserById, updateUser } },
    setCookie: vi.fn(),
    findUserById,
    updateUser,
  };
}

/**
 * session.create.after only uses ctx.context.internalAdapter and ctx.headers; user.create.after also
 * uses ctx.setCookie.
 */
function hookCtx(ctx: ReturnType<typeof createCtx>) {
  return {
    headers: ctx.headers,
    context: ctx.context,
    setCookie: ctx.setCookie,
  };
}

function account(overrides: Record<string, unknown> = {}) {
  return {
    id: "user_1",
    email: "ada@example.com",
    emailVerified: true,
    name: "Ada",
    image: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queued.length = 0;
  mocks.sendEmail.mockResolvedValue(undefined);
  mocks.registerAttribution.mockResolvedValue(undefined);
  mocks.bindReferral.mockResolvedValue(undefined);
  mocks.linkRegistration.mockResolvedValue(undefined);
  mocks.trackServer.mockResolvedValue(undefined);
});

describe("Better Auth config", () => {
  test("nextCookies is the last plugin (Server Actions must be able to write cookies too)", () => {
    const ids = pluginIds(optionsOf(auth));
    expect(ids.filter((id) => id === "next-cookies")).toHaveLength(1);
    expect(ids.at(-1)).toBe("next-cookies");
  });

  test("custom plugins come before emailOTP: the cooldown must block resends before sending", () => {
    const ids = pluginIds(optionsOf(auth));
    expect(ids).toContain("identify-session-user");
    expect(ids).toContain("otp-resend-cooldown");
    expect(ids.indexOf("identify-session-user")).toBeLessThan(
      ids.indexOf("email-otp"),
    );
    expect(ids.indexOf("otp-resend-cooldown")).toBeLessThan(
      ids.indexOf("email-otp"),
    );
  });

  test("the admin plugin is always registered, before nextCookies", () => {
    const ids = pluginIds(optionsOf(auth));
    expect(ids).toContain("admin");
    expect(ids.indexOf("admin")).toBeLessThan(ids.indexOf("next-cookies"));
  });

  test("emailOTP options match siteConfig.auth.emailOtp", () => {
    const otp = plugin(optionsOf(auth), "email-otp").options ?? {};
    expect(otp.otpLength).toBe(siteConfig.auth.emailOtp.length);
    expect(otp.expiresIn).toBe(siteConfig.auth.emailOtp.expiresIn);
    expect(otp.allowedAttempts).toBe(siteConfig.auth.emailOtp.allowedAttempts);
    // Codes are stored only as hashes; the plaintext is never in the database.
    expect(otp.storeOTP).toBe("hashed");
    // The plugin itself rate limits sends by IP; the per-email resend cooldown is otpResendCooldown's
    // job.
    expect(otp.rateLimit).toEqual({ window: 60, max: 5 });
  });

  test("the resend cooldown seconds come from siteConfig.auth.emailOtp.resendCooldown", async () => {
    const { handler } = beforeHook(optionsOf(auth), "otp-resend-cooldown");
    const created: { identifier: string; value: string; expiresAt: Date }[] =
      [];
    await handler({
      path: "/email-otp/send-verification-otp",
      body: { email: "ada@example.com" },
      context: {
        internalAdapter: {
          findVerificationValue: async () => undefined,
          deleteVerificationByIdentifier: async () => undefined,
          createVerificationValue: async (value: never) => {
            created.push(value);
          },
        },
      },
    });

    expect(created).toHaveLength(1);
    const record = created[0]!;
    expect(record.identifier).toBe(cooldownIdentifier("ada@example.com"));
    // Compute the interval as expiresAt - value, independent of the real clock.
    expect(
      new Date(record.expiresAt).getTime() - new Date(record.value).getTime(),
    ).toBe(siteConfig.auth.emailOtp.resendCooldown * 1000);
  });

  test("the admin plugin sets the ban message and doesn't allow impersonation", () => {
    const adminOptions = plugin(optionsOf(auth), "admin").options as {
      bannedUserMessage: string;
      roles: { admin: { statements: { user: string[] } } };
    };
    expect(adminOptions.bannedUserMessage).toBe(
      "This account has been suspended.",
    );
    const actions = adminOptions.roles.admin.statements.user;
    expect(
      actions.filter((action) => action.startsWith("impersonate")),
    ).toEqual([]);
    // Don't strip permissions down to an empty shell: the usual user management actions remain.
    expect(actions).toContain("ban");
    expect(actions).toContain("update");
  });

  test("account linking: trusts Google, so both sign-in paths for the same email reach one account", () => {
    const options = optionsOf(auth);
    expect(options.account.accountLinking.enabled).toBe(true);
    expect(options.account.accountLinking.trustedProviders).toContain("google");
  });

  test("the One Tap callback endpoint is rate limited by IP so it can't be abused as a free verification service", () => {
    const rules = optionsOf(auth).rateLimit.customRules;
    expect(rules["/sign-in/social"]).toEqual({ window: 60, max: 10 });
    expect(rules["/one-tap/callback"]).toEqual({ window: 60, max: 10 });
  });

  test("the locale field only accepts locales enabled on the site", () => {
    const field = optionsOf(auth).user.additionalFields.locale;
    for (const locale of routing.locales) {
      expect(field.validator.input.safeParse(locale).success).toBe(true);
    }
    expect(field.validator.input.safeParse("fr").success).toBe(false);
    expect(field.validator.input.safeParse(undefined).success).toBe(false);
  });

  test("baseURL comes from resolveAuthBaseURL", () => {
    expect(optionsOf(auth).baseURL).toEqual(
      resolveAuthBaseURL(process.env, siteConfig.domain),
    );
  });
});

describe("Google credentials and One Tap", () => {
  test("Google credentials decide whether socialProviders and oneTap are registered", () => {
    const options = optionsOf(auth);
    // Local .env.local and CI differ in which credentials they have; expected values are derived
    // from the same check function, so the test holds in both.
    expect(pluginIds(options).includes("one-tap")).toBe(hasGoogle);
    if (hasGoogle) {
      const credentials = googleCredentials(process.env);
      expect(options.socialProviders?.google).toMatchObject({
        clientId: credentials?.clientId,
        // Always ask which account to use; don't silently reuse the last one.
        prompt: "select_account",
      });
      // One Tap's audience has a single source: the same clientId as socialProviders.
      expect(plugin(options, "one-tap").options?.clientId).toBe(
        credentials?.clientId,
      );
    } else {
      expect(options.socialProviders).toBeUndefined();
    }
  });

  test("without credentials (local / CI / preview) there are no socialProviders at all", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", undefined);
    vi.stubEnv("GOOGLE_CLIENT_SECRET", undefined);
    try {
      expect(googleCredentials(process.env)).toBeUndefined();
      const options = await freshAuth();
      expect(options.socialProviders).toBeUndefined();
      expect(pluginIds(options)).not.toContain("one-tap");
      // Without One Tap, emailOTP and admin are still wired up as usual.
      expect(pluginIds(options)).toContain("email-otp");
      expect(pluginIds(options)).toContain("admin");
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});

describe("sendVerificationOTP", () => {
  function sendVerificationOTP() {
    const configured = plugin(optionsOf(auth), "email-otp").options
      ?.sendVerificationOTP;
    expect(typeof configured).toBe("function");
    return configured as (
      data: { email: string; otp: string; type: string },
      ctx: unknown,
    ) => Promise<void>;
  }

  function otpCtx({
    headers,
    deleteFails,
  }: { headers?: Headers; deleteFails?: boolean } = {}) {
    const deleteVerificationByIdentifier = deleteFails
      ? vi.fn(async () => {
          throw new Error("db down");
        })
      : vi.fn(async () => undefined);
    return {
      headers,
      context: { internalAdapter: { deleteVerificationByIdentifier } },
      deleteVerificationByIdentifier,
    };
  }

  // Which types send which email is decided by `otpEmail()` (see otp-email.test.ts); this only pins
  // down that a null mapping does nothing: no email, and the cooldown is left alone.
  test("types without a template send nothing and leave the cooldown alone", async () => {
    const ctx = otpCtx({ headers: new Headers({ "x-locale": "en" }) });
    await sendVerificationOTP()(
      { email: "ada@example.com", otp: "123456", type: "forget-password" },
      ctx,
    );
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(ctx.deleteVerificationByIdentifier).not.toHaveBeenCalled();
  });

  test("sign-in sends the sign-in-code email with the expiry rounded to minutes", async () => {
    const ctx = otpCtx({ headers: new Headers({ "x-locale": "en" }) });
    await sendVerificationOTP()(
      { email: "ada@example.com", otp: "123456", type: "sign-in" },
      ctx,
    );
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendEmail).toHaveBeenCalledWith({
      to: "ada@example.com",
      template: "sign-in-code",
      props: {
        code: "123456",
        expiresInMinutes: Math.round(siteConfig.auth.emailOtp.expiresIn / 60),
      },
      locale: "en",
    });
    // A successful send leaves the cooldown in place; the user must wait for it to end to resend.
    expect(ctx.deleteVerificationByIdentifier).not.toHaveBeenCalled();
  });

  test("send failure: deletes the cooldown record and throws EMAIL_SEND_FAILED so the user can retry right away", async () => {
    const ctx = otpCtx({ headers: new Headers({ "x-locale": "en" }) });
    mocks.sendEmail.mockRejectedValue(new Error("resend 502"));

    const error = await sendVerificationOTP()(
      { email: " Ada@Example.com ", otp: "123456", type: "sign-in" },
      ctx,
    ).catch((thrown: unknown) => thrown);

    expect(mocks.loggerError).toHaveBeenCalledWith("auth.otp_email_failed", {
      type: "sign-in",
      outcome: "retry",
    });
    // The identifier is normalized by email, the same key the cooldown plugin writes.
    expect(ctx.deleteVerificationByIdentifier).toHaveBeenCalledWith(
      cooldownIdentifier(" Ada@Example.com "),
    );
    expect(error).toBeInstanceOf(APIError);
    expect(error).toMatchObject({
      status: "BAD_GATEWAY",
      statusCode: 502,
      body: { code: EMAIL_SEND_FAILED },
    });
  });

  test("enqueue failure (database unavailable): still a clear EMAIL_SEND_FAILED, not a 500; the cooldown is cleared for an immediate retry", async () => {
    const ctx = otpCtx({ headers: new Headers({ "x-locale": "en" }) });
    vi.mocked(notificationOutbox.enqueue).mockRejectedValueOnce(
      new Error("connection refused"),
    );

    const error = await sendVerificationOTP()(
      { email: "ada@example.com", otp: "123456", type: "sign-in" },
      ctx,
    ).catch((thrown: unknown) => thrown);

    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.loggerError).toHaveBeenCalledWith("auth.otp_email_failed", {
      type: "sign-in",
      outcome: "enqueue_failed",
    });
    expect(ctx.deleteVerificationByIdentifier).toHaveBeenCalledWith(
      cooldownIdentifier("ada@example.com"),
    );
    expect(error).toMatchObject({
      statusCode: 502,
      body: { code: EMAIL_SEND_FAILED },
    });

    // Request again once the database recovers (cooldown cleared): sent normally.
    await sendVerificationOTP()(
      { email: "ada@example.com", otp: "654321", type: "sign-in" },
      ctx,
    );
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
  });

  test("enqueued codes are stored encrypted, expire, and supersede unsent older codes for the same email", async () => {
    const ctx = otpCtx({ headers: new Headers({ "x-locale": "en" }) });
    await sendVerificationOTP()(
      { email: "Ada@Example.com", otp: "123456", type: "sign-in" },
      ctx,
    );
    expect(notificationOutbox.enqueue).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: "sign-in-code",
        key: "sign-in:ada@example.com",
        sensitive: true,
        supersede: true,
        expiresAt: expect.any(Date),
      }),
    );
  });

  test("throws the same error even when deleting the cooldown record fails (an uncleared cooldown beats no error)", async () => {
    const ctx = otpCtx({
      headers: new Headers({ "x-locale": "en" }),
      deleteFails: true,
    });
    mocks.sendEmail.mockRejectedValue(new Error("resend 502"));

    await expect(
      sendVerificationOTP()(
        { email: "ada@example.com", otp: "123456", type: "sign-in" },
        ctx,
      ),
    ).rejects.toMatchObject({ body: { code: EMAIL_SEND_FAILED } });
    expect(ctx.deleteVerificationByIdentifier).toHaveBeenCalled();
  });

  test("throws the same error without a ctx (internal calls)", async () => {
    mocks.sendEmail.mockRejectedValue(new Error("resend 502"));
    await expect(
      sendVerificationOTP()(
        { email: "ada@example.com", otp: "123456", type: "sign-in" },
        undefined,
      ),
    ).rejects.toMatchObject({ body: { code: EMAIL_SEND_FAILED } });
  });

  test("the email language follows the request headers", async () => {
    const ctx = otpCtx({
      headers: new Headers({ cookie: `NEXT_LOCALE=${secondLocale}` }),
    });
    await sendVerificationOTP()(
      { email: "ada@example.com", otp: "123456", type: "sign-in" },
      ctx,
    );
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ locale: secondLocale }),
    );
  });
});

describe("session.create.after", () => {
  afterAll(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function sessionHook() {
    vi.stubEnv("ADMIN_EMAILS", ADMIN_EMAIL);
    const { sessionAfter } = await importHooks();
    return sessionAfter;
  }

  test("does nothing without a ctx (no adapter available)", async () => {
    const hook = await sessionHook();
    await hook({ userId: "user_1" }, null);
    expect(mocks.linkRegistration).not.toHaveBeenCalled();
  });

  test("verified users in ADMIN_EMAILS are promoted to admin on sign-in", async () => {
    const hook = await sessionHook();
    const ctx = createCtx({
      user: account({ email: ADMIN_EMAIL.toUpperCase() }),
    });
    await hook({ userId: "user_1" }, hookCtx(ctx));

    expect(ctx.findUserById).toHaveBeenCalledWith("user_1");
    // Matches the admin plugin's role spelling: just admin.
    expect(ctx.updateUser).toHaveBeenCalledWith("user_1", { role: "admin" });
  });

  test("unverified emails, users not on the list, and existing admins are not promoted again", async () => {
    const hook = await sessionHook();

    for (const user of [
      account({ email: ADMIN_EMAIL, emailVerified: false }),
      account({ email: "someone@example.com" }),
      account({ email: ADMIN_EMAIL, role: "admin,user" }),
    ]) {
      const ctx = createCtx({ user });
      await hook({ userId: "user_1" }, hookCtx(ctx));
      expect(ctx.updateUser).not.toHaveBeenCalled();
    }
  });

  test("skips promotion and lead linking when the adapter can't find the user", async () => {
    const hook = await sessionHook();
    const ctx = createCtx({});
    await hook({ userId: "ghost" }, hookCtx(ctx));
    expect(ctx.updateUser).not.toHaveBeenCalled();
    expect(mocks.linkRegistration).not.toHaveBeenCalled();
  });

  test("passes channel attribution on to an existing lead when there is no source cookie", async () => {
    const hook = await sessionHook();
    const user = account({ email: "ada@example.com" });
    const ctx = createCtx({ user });
    await hook({ userId: user.id }, hookCtx(ctx));

    expect(mocks.linkRegistration).toHaveBeenCalledWith(user, true);
  });

  test("still links leads without ADMIN_EMAILS configured, but promotes no one", async () => {
    vi.stubEnv("ADMIN_EMAILS", undefined);
    const { sessionAfter } = await importHooks();
    const user = account({ email: ADMIN_EMAIL });
    const ctx = createCtx({ user });
    await sessionAfter({ userId: user.id }, hookCtx(ctx));

    // The early return requires "no admin emails **and** leads disabled"; leads are on here.
    expect(ctx.findUserById).toHaveBeenCalledWith(user.id);
    expect(mocks.linkRegistration).toHaveBeenCalledWith(user, true);
    expect(ctx.updateUser).not.toHaveBeenCalled();
  });

  test("doesn't pass on the source when the user explicitly declined attribution", async () => {
    const hook = await sessionHook();
    const user = account();
    const ctx = createCtx({
      user,
      headers: new Headers({ cookie: "source_preference=declined" }),
    });
    await hook({ userId: user.id }, hookCtx(ctx));

    expect(mocks.linkRegistration).toHaveBeenCalledWith(user, false);
  });

  test("a lead linking failure is only logged and doesn't affect this sign-in", async () => {
    const hook = await sessionHook();
    const user = account();
    const ctx = createCtx({ user });
    mocks.linkRegistration.mockRejectedValue(new Error("db down"));

    await expect(
      hook({ userId: user.id }, hookCtx(ctx)),
    ).resolves.toBeUndefined();
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      "leads.registration_link_failed",
      { userId: user.id },
    );
  });
});

describe("user.create.after", () => {
  afterAll(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function createHook() {
    vi.stubEnv("ADMIN_EMAILS", ADMIN_EMAIL);
    const { userAfter } = await importHooks();
    return userAfter;
  }

  test("runs attribution, referral binding, and lead linking in order, and queues emails last", async () => {
    const hook = await createHook();
    const order: string[] = [];
    mocks.registerAttribution.mockImplementation(async () => {
      order.push("attribution");
    });
    mocks.bindReferral.mockImplementation(async () => {
      order.push("referral");
    });
    mocks.linkRegistration.mockImplementation(async () => {
      order.push("leads");
    });
    mocks.trackServer.mockImplementation(async () => {
      order.push("track");
    });
    mocks.sendEmail.mockImplementation(async () => {
      order.push("welcome");
    });

    const user = account();
    const ctx = createCtx({ user, headers: new Headers({ "x-locale": "en" }) });
    await hook(user, hookCtx(ctx));

    // Synchronous part: record attribution, then bind the referral, then link the lead.
    expect(order).toEqual(["attribution", "referral", "leads"]);

    // Emails and the conversion event are queued after the response: nothing is sent before the
    // sign-up request returns.
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.trackServer).not.toHaveBeenCalled();
    expect(mocks.queued).toHaveLength(2);

    for (const task of mocks.queued) await task();
    expect(order).toEqual([
      "attribution",
      "referral",
      "leads",
      "welcome",
      "track",
    ]);
  });

  test("attribution can write cookies, and referral binding and lead linking get the same headers", async () => {
    const hook = await createHook();
    const user = account();
    const headers = new Headers({ "x-locale": "en" });
    const ctx = createCtx({ user, headers });
    await hook(user, hookCtx(ctx));

    expect(mocks.registerAttribution).toHaveBeenCalledWith(
      user.id,
      headers,
      expect.any(Function),
    );
    expect(mocks.bindReferral).toHaveBeenCalledWith(user.id, headers);
    expect(mocks.linkRegistration).toHaveBeenCalledWith(user, true);
  });

  test("attribution and referral binding are built from the config flags and the same secret", async () => {
    const hook = await createHook();
    const user = account();
    // The service is created lazily (createLeadService(db) only runs on call), so run the hook once
    // first.
    await hook(user, hookCtx(createCtx({ user })));

    // Signing and signature verification must use the same secret, or the sign-up context can't be
    // read back.
    const secret = env.BETTER_AUTH_SECRET;
    expect(mocks.createRegistrationAttribution).toHaveBeenCalledWith({
      enabled: siteConfig.acquisition.attribution.enabled,
      secret,
      freeze: mocks.freeze,
      warn: expect.any(Function),
    });
    expect(mocks.createReferralBinding).toHaveBeenCalledWith({
      enabled: siteConfig.acquisition.referrals.enabled,
      secret,
      bind: mocks.bind,
      warn: expect.any(Function),
    });
    // Both services sit on the same db (the empty object in the mock).
    expect(mocks.createLeadService).toHaveBeenCalledWith(expect.anything());
    expect(mocks.createReferralService).toHaveBeenCalledWith(expect.anything());

    // The warning sink is the structured logger: internal failures in both modules end up here.
    const [registrationDeps] = mocks.createRegistrationAttribution.mock
      .calls[0] as unknown as [
      { warn: (event: string, fields: unknown) => void },
    ];
    registrationDeps.warn("acquisition.freeze_failed", { userId: user.id });
    expect(mocks.loggerWarn).toHaveBeenCalledWith("acquisition.freeze_failed", {
      userId: user.id,
    });

    const [referralDeps] = mocks.createReferralBinding.mock
      .calls[0] as unknown as [
      { warn: (event: string, fields?: Record<string, unknown>) => void },
    ];
    referralDeps.warn("referrals.bind_failed", { userId: user.id });
    expect(mocks.loggerWarn).toHaveBeenCalledWith("referrals.bind_failed", {
      userId: user.id,
    });
  });

  test("passes no setCookie without a ctx, and sign-up still works", async () => {
    const hook = await createHook();
    const user = account();
    await expect(hook(user, null)).resolves.toBeUndefined();
    expect(mocks.registerAttribution).toHaveBeenCalledWith(
      user.id,
      undefined,
      undefined,
    );
  });

  test("when attribution fails it can use ctx to write a 24h retry cookie", async () => {
    const hook = await createHook();
    const user = account();
    const ctx = createCtx({ user });
    await hook(user, hookCtx(ctx));

    // server.ts wraps ctx.setCookie and hands it to the attribution module: only it can write
    // cookies (the retry token) within the request scope, so this forwarding must stay.
    const setCookie = mocks.registerAttribution.mock.calls[0]?.[2] as
      | ((name: string, value: string, options: { maxAge: number }) => unknown)
      | undefined;
    expect(typeof setCookie).toBe("function");
    setCookie?.("acquisition_registration", "token", { maxAge: 86_400 });
    expect(ctx.setCookie).toHaveBeenCalledWith(
      "acquisition_registration",
      "token",
      { maxAge: 86_400 },
    );
  });

  test("a lead linking failure is only logged and doesn't affect sign-up", async () => {
    const hook = await createHook();
    const user = account();
    mocks.linkRegistration.mockRejectedValue(new Error("db down"));

    await expect(
      hook(user, hookCtx(createCtx({ user }))),
    ).resolves.toBeUndefined();
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      "leads.registration_link_failed",
      { userId: user.id },
    );
    // A failure also mustn't block the welcome email or the conversion event.
    expect(mocks.queued).toHaveLength(2);
  });

  test("a failed welcome email is only logged, and the task doesn't throw", async () => {
    const hook = await createHook();
    mocks.sendEmail.mockRejectedValue(new Error("resend 502"));
    const user = account();
    await hook(user, hookCtx(createCtx({ user })));

    for (const task of mocks.queued) {
      await expect(task()).resolves.toBeUndefined();
    }
    expect(mocks.loggerError).toHaveBeenCalledWith(
      "auth.welcome_email_failed",
      { error: expect.any(Error), userId: user.id },
    );
  });

  test("the welcome email uses the request locale and passes undefined when the name is missing", async () => {
    const hook = await createHook();
    const user = account({ name: "" });
    await hook(
      user,
      hookCtx(
        createCtx({
          user,
          headers: new Headers({ "x-locale": secondLocale }),
        }),
      ),
    );

    for (const task of mocks.queued) await task();
    expect(mocks.sendEmail).toHaveBeenCalledWith({
      to: user.email,
      template: "welcome",
      props: { name: undefined },
      locale: secondLocale,
    });
  });

  test("the sign-up event carries the visitor headers for the same source attribution", async () => {
    const hook = await createHook();
    const user = account();
    const headers = new Headers({ "x-locale": "en" });
    await hook(user, hookCtx(createCtx({ user, headers })));

    for (const task of mocks.queued) await task();
    expect(mocks.trackServer).toHaveBeenCalledWith("sign_up", undefined, {
      headers,
    });
  });

  test('lead linking infers whether to inherit the channel from "source not declined"', async () => {
    const hook = await createHook();
    const declined = new Headers({ cookie: "source_preference=declined" });
    const user = account();
    await hook(user, hookCtx(createCtx({ user, headers: declined })));

    expect(mocks.linkRegistration).toHaveBeenCalledWith(user, false);
  });
});
