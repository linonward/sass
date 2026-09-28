// @vitest-environment node
// t3-env 只在服务端校验 server 变量：jsdom 下 import 本模块会被当成客户端，
// 读 env.ADMIN_EMAILS 直接抛错（见 src/core/env.ts）。这里和 env.test.ts 一样走 node。
import { APIError } from "better-auth/api";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";

import { env } from "@/core/env";
import { routing } from "@/core/i18n/routing";

import siteConfig from "../../../site.config";
import { cooldownIdentifier } from "./cooldown";
import { googleCredentials, resolveAuthBaseURL } from "./env";
import { EMAIL_SEND_FAILED } from "./errors";
import { auth } from "./server";

/**
 * 协作者全部替换成 mock：不连库、不发信、不进请求作用域。断言只对着
 * server.ts 自己写的那几段（插件装配、验证码回调、两个 databaseHook）。
 *
 * 工厂函数的返回值在 vi.hoisted 里就定好，因为 server.ts 在 import 时就会调用它们
 * （createAttributionStore(db).freeze 这种），比任何 beforeEach 都早。
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
  /** runAfterResponse 收到的任务；测试里手动 drain，模拟「响应之后」。 */
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

// 不真调 next/server 的 after（测试里不在请求作用域），只把任务排队，
// 这样能验证「发信排在响应之后」而不是「注册时同步发信」。
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

// 演示站配置里 leads / attribution 是关的，那两条分支就不会执行。这里只把
// acquisition 的三个开关打开（其余字段原样保留），让 hook 里对应的分支可达。
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

/** hook 的入参类型来自 better-auth，测试里不需要精确，用 unknown 调用。 */
type UnknownHook = (value: unknown, ctx: unknown) => Promise<void>;

const ADMIN_EMAIL = "admin@example.com";
const hasGoogle = Boolean(googleCredentials(process.env));
/** 非默认语言，用来验证「邮件语言跟随请求」；站点至少配了一门语言（schema 保证）。 */
const secondLocale = routing.locales[1] ?? routing.locales[0] ?? "en";

function optionsOf(instance: unknown): ServerOptions {
  return (instance as { options: ServerOptions }).options;
}

function pluginIds(options: ServerOptions): string[] {
  return options.plugins.map((plugin) => plugin.id);
}

function plugin(options: ServerOptions, id: string): PluginLike {
  const found = options.plugins.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`插件 ${id} 没有注册`);
  return found;
}

/** 插件的 before-hook：matcher 决定是否命中，handler 是真正的逻辑。 */
type BeforeHook = {
  matcher: (context: { path: string }) => boolean;
  handler: (ctx: unknown) => Promise<unknown>;
};

function beforeHook(options: ServerOptions, id: string): BeforeHook {
  const hooks = plugin(options, id).hooks as { before: BeforeHook[] };
  const [first] = hooks.before;
  if (!first) throw new Error(`插件 ${id} 没有 before hook`);
  return first;
}

/** resetModules 之后再 import，才能让被 stub 的环境变量进入 env / server 的模块级常量。 */
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
 * session.create.after 只用到 ctx.context.internalAdapter 和 ctx.headers；
 * user.create.after 多用到 ctx.setCookie。
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

describe("Better Auth 配置", () => {
  test("nextCookies 是最后一个插件（Server Action 里也要能写 cookie）", () => {
    const ids = pluginIds(optionsOf(auth));
    expect(ids.filter((id) => id === "next-cookies")).toHaveLength(1);
    expect(ids.at(-1)).toBe("next-cookies");
  });

  test("自定义插件排在 emailOTP 之前：cooldown 要在发信前拦下重发", () => {
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

  test("admin 插件一直注册，且排在 nextCookies 之前", () => {
    const ids = pluginIds(optionsOf(auth));
    expect(ids).toContain("admin");
    expect(ids.indexOf("admin")).toBeLessThan(ids.indexOf("next-cookies"));
  });

  test("emailOTP 的参数与 siteConfig.auth.emailOtp 一致", () => {
    const otp = plugin(optionsOf(auth), "email-otp").options ?? {};
    expect(otp.otpLength).toBe(siteConfig.auth.emailOtp.length);
    expect(otp.expiresIn).toBe(siteConfig.auth.emailOtp.expiresIn);
    expect(otp.allowedAttempts).toBe(siteConfig.auth.emailOtp.allowedAttempts);
    // 验证码只存哈希，库里拿不到明文。
    expect(otp.storeOTP).toBe("hashed");
    // 按 IP 的发送频率由插件自己限，按邮箱的重发冷却由 otpResendCooldown 负责。
    expect(otp.rateLimit).toEqual({ window: 60, max: 5 });
  });

  test("重发冷却秒数取自 siteConfig.auth.emailOtp.resendCooldown", async () => {
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
    // 用 expiresAt - value 算间隔，不依赖真实时钟。
    expect(
      new Date(record.expiresAt).getTime() - new Date(record.value).getTime(),
    ).toBe(siteConfig.auth.emailOtp.resendCooldown * 1000);
  });

  test("admin 插件带上封禁提示，且不开放模拟登录", () => {
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
    // 别把权限收得只剩空壳：常规的用户管理动作还在。
    expect(actions).toContain("ban");
    expect(actions).toContain("update");
  });

  test("账号合并：信任 Google，同邮箱两条登录路径进同一个账号", () => {
    const options = optionsOf(auth);
    expect(options.account.accountLinking.enabled).toBe(true);
    expect(options.account.accountLinking.trustedProviders).toContain("google");
  });

  test("One Tap 回调端点按 IP 限流，挡住被当成免费验签服务刷", () => {
    const rules = optionsOf(auth).rateLimit.customRules;
    expect(rules["/sign-in/social"]).toEqual({ window: 60, max: 10 });
    expect(rules["/one-tap/callback"]).toEqual({ window: 60, max: 10 });
  });

  test("locale 字段只接受站点启用的语言", () => {
    const field = optionsOf(auth).user.additionalFields.locale;
    for (const locale of routing.locales) {
      expect(field.validator.input.safeParse(locale).success).toBe(true);
    }
    expect(field.validator.input.safeParse("fr").success).toBe(false);
    expect(field.validator.input.safeParse(undefined).success).toBe(false);
  });

  test("baseURL 与 resolveAuthBaseURL 同源", () => {
    expect(optionsOf(auth).baseURL).toEqual(
      resolveAuthBaseURL(process.env, siteConfig.domain),
    );
  });
});

describe("Google 凭据与 One Tap", () => {
  test("有没有 Google 凭据决定 socialProviders 和 oneTap 的注册", () => {
    const options = optionsOf(auth);
    // 本地 .env.local 和 CI 的凭据情况不同，期望值从同一个判断函数推导，两边都成立。
    expect(pluginIds(options).includes("one-tap")).toBe(hasGoogle);
    if (hasGoogle) {
      const credentials = googleCredentials(process.env);
      expect(options.socialProviders?.google).toMatchObject({
        clientId: credentials?.clientId,
        // 每次都要问用哪个账号，别静默用上一次的。
        prompt: "select_account",
      });
      // One Tap 的 audience 只有一个来源：和 socialProviders 同一个 clientId。
      expect(plugin(options, "one-tap").options?.clientId).toBe(
        credentials?.clientId,
      );
    } else {
      expect(options.socialProviders).toBeUndefined();
    }
  });

  test("缺凭据时（本地 / CI / 预览）连 socialProviders 都不给", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", undefined);
    vi.stubEnv("GOOGLE_CLIENT_SECRET", undefined);
    try {
      expect(googleCredentials(process.env)).toBeUndefined();
      const options = await freshAuth();
      expect(options.socialProviders).toBeUndefined();
      expect(pluginIds(options)).not.toContain("one-tap");
      // 少了 One Tap，emailOTP 和 admin 照常装配。
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

  // 哪些类型发哪种邮件由 `otpEmail()` 决定（见 otp-email.test.ts），这里只钉住
  // 「映射返回 null 时什么都不做」：不发信，也不动冷却。
  test("没有对应模板的类型不发信，也不动冷却", async () => {
    const ctx = otpCtx({ headers: new Headers({ "x-locale": "en" }) });
    await sendVerificationOTP()(
      { email: "ada@example.com", otp: "123456", type: "forget-password" },
      ctx,
    );
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(ctx.deleteVerificationByIdentifier).not.toHaveBeenCalled();
  });

  test("sign-in 时发 sign-in-code 邮件，过期时间按分钟取整", async () => {
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
    // 发成功就不动冷却，用户必须等冷却结束才能重发。
    expect(ctx.deleteVerificationByIdentifier).not.toHaveBeenCalled();
  });

  test("发信失败：删掉冷却记录并抛 EMAIL_SEND_FAILED，让用户可以立刻重试", async () => {
    const ctx = otpCtx({ headers: new Headers({ "x-locale": "en" }) });
    mocks.sendEmail.mockRejectedValue(new Error("resend 502"));

    const error = await sendVerificationOTP()(
      { email: " Ada@Example.com ", otp: "123456", type: "sign-in" },
      ctx,
    ).catch((thrown: unknown) => thrown);

    expect(mocks.loggerError).toHaveBeenCalledWith("auth.otp_email_failed", {
      error: expect.any(Error),
      type: "sign-in",
    });
    // identifier 按邮箱归一化，和 cooldown 插件写进去的是同一个 key。
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

  test("删冷却记录本身失败也要抛同一个错误（冷却没清掉好过不报错）", async () => {
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

  test("没有 ctx 时（内部调用）也能抛出同一个错误", async () => {
    mocks.sendEmail.mockRejectedValue(new Error("resend 502"));
    await expect(
      sendVerificationOTP()(
        { email: "ada@example.com", otp: "123456", type: "sign-in" },
        undefined,
      ),
    ).rejects.toMatchObject({ body: { code: EMAIL_SEND_FAILED } });
  });

  test("邮件语言跟随请求头", async () => {
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

  test("ctx 缺失时什么都不做（adapter 拿不到）", async () => {
    const hook = await sessionHook();
    await hook({ userId: "user_1" }, null);
    expect(mocks.linkRegistration).not.toHaveBeenCalled();
  });

  test("ADMIN_EMAILS 里的已验证用户登录后提升为 admin", async () => {
    const hook = await sessionHook();
    const ctx = createCtx({
      user: account({ email: ADMIN_EMAIL.toUpperCase() }),
    });
    await hook({ userId: "user_1" }, hookCtx(ctx));

    expect(ctx.findUserById).toHaveBeenCalledWith("user_1");
    // 与 admin 插件的角色拼法一致：只写 admin。
    expect(ctx.updateUser).toHaveBeenCalledWith("user_1", { role: "admin" });
  });

  test("未验证邮箱、不在名单或已是 admin 都不重复提升", async () => {
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

  test("适配器查不到用户时跳过提升和留资", async () => {
    const hook = await sessionHook();
    const ctx = createCtx({});
    await hook({ userId: "ghost" }, hookCtx(ctx));
    expect(ctx.updateUser).not.toHaveBeenCalled();
    expect(mocks.linkRegistration).not.toHaveBeenCalled();
  });

  test("没有来源 cookie 时把渠道归因继承给已有留资", async () => {
    const hook = await sessionHook();
    const user = account({ email: "ada@example.com" });
    const ctx = createCtx({ user });
    await hook({ userId: user.id }, hookCtx(ctx));

    expect(mocks.linkRegistration).toHaveBeenCalledWith(user, true);
  });

  test("没配 ADMIN_EMAILS 时照样为留资做链接，但没人被提升", async () => {
    vi.stubEnv("ADMIN_EMAILS", undefined);
    const { sessionAfter } = await importHooks();
    const user = account({ email: ADMIN_EMAIL });
    const ctx = createCtx({ user });
    await sessionAfter({ userId: user.id }, hookCtx(ctx));

    // 提前返回的条件是「没有管理员邮箱 **且** 留资关闭」，这里留资开着。
    expect(ctx.findUserById).toHaveBeenCalledWith(user.id);
    expect(mocks.linkRegistration).toHaveBeenCalledWith(user, true);
    expect(ctx.updateUser).not.toHaveBeenCalled();
  });

  test("用户明确拒绝归因时不继承来源", async () => {
    const hook = await sessionHook();
    const user = account();
    const ctx = createCtx({
      user,
      headers: new Headers({ cookie: "source_preference=declined" }),
    });
    await hook({ userId: user.id }, hookCtx(ctx));

    expect(mocks.linkRegistration).toHaveBeenCalledWith(user, false);
  });

  test("留资链接失败只记日志，不影响这次登录", async () => {
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

  test("归因、邀请绑定、留资链接按顺序执行，最后才排队发信", async () => {
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

    // 同步部分：先记归因、再绑邀请、最后连留资。
    expect(order).toEqual(["attribution", "referral", "leads"]);

    // 邮件和转化事件排在响应之后：注册请求返回前不会发信。
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

  test("归因拿到写 cookie 的能力，邀请绑定和留资拿到同一份 headers", async () => {
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

  test("归因和邀请绑定用配置开关与同一个 secret 构造", async () => {
    const hook = await createHook();
    const user = account();
    // service 是惰性取的（调用时才 createLeadService(db)），所以要先跑一次 hook。
    await hook(user, hookCtx(createCtx({ user })));

    // 签名与验签必须是同一个 secret，否则注册时的上下文读不回来。
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
    // 两个 service 都挂在同一个 db 上（mock 里就是那个空对象）。
    expect(mocks.createLeadService).toHaveBeenCalledWith(expect.anything());
    expect(mocks.createReferralService).toHaveBeenCalledWith(expect.anything());

    // 告警出口接的是结构化日志：两个模块内部的失败都会走到这里。
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

  test("ctx 缺失时不传 setCookie，也不影响注册", async () => {
    const hook = await createHook();
    const user = account();
    await expect(hook(user, null)).resolves.toBeUndefined();
    expect(mocks.registerAttribution).toHaveBeenCalledWith(
      user.id,
      undefined,
      undefined,
    );
  });

  test("归因失败时能借 ctx 写下 24h 重试 cookie", async () => {
    const hook = await createHook();
    const user = account();
    const ctx = createCtx({ user });
    await hook(user, hookCtx(ctx));

    // server.ts 把 ctx.setCookie 包一层交给归因模块：只有它在 request 作用域里
    // 才写得出 cookie（重试令牌），所以这层转发不能丢。
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

  test("留资链接失败只记日志，不影响注册", async () => {
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
    // 失败也不该拦住欢迎邮件和转化事件。
    expect(mocks.queued).toHaveLength(2);
  });

  test("发欢迎邮件失败只记日志，任务不抛错", async () => {
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

  test("欢迎邮件用请求语言，名字缺省时传 undefined", async () => {
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

  test("注册事件带访客 headers，用同一份来源统计", async () => {
    const hook = await createHook();
    const user = account();
    const headers = new Headers({ "x-locale": "en" });
    await hook(user, hookCtx(createCtx({ user, headers })));

    for (const task of mocks.queued) await task();
    expect(mocks.trackServer).toHaveBeenCalledWith("sign_up", undefined, {
      headers,
    });
  });

  test("留资链接用「未拒绝来源」推断是否继承渠道", async () => {
    const hook = await createHook();
    const declined = new Headers({ cookie: "source_preference=declined" });
    const user = account();
    await hook(user, hookCtx(createCtx({ user, headers: declined })));

    expect(mocks.linkRegistration).toHaveBeenCalledWith(user, false);
  });
});
