import { describe, expect, test, vi } from "vitest";

import { RESEND_COOLDOWN } from "./errors";
import {
  cooldownIdentifier,
  otpResendCooldown,
  remainingCooldown,
} from "./cooldown";

describe("remainingCooldown", () => {
  const now = new Date("2026-01-01T00:00:00Z");

  test("没有记录或已过期时为 0", () => {
    expect(remainingCooldown(undefined, now)).toBe(0);
    expect(remainingCooldown(new Date("2025-12-31T23:59:59Z"), now)).toBe(0);
  });

  test("冷却中时向上取整到秒", () => {
    expect(remainingCooldown(new Date("2026-01-01T00:00:59.200Z"), now)).toBe(
      60,
    );
    expect(remainingCooldown(new Date("2026-01-01T00:00:01Z"), now)).toBe(1);
  });

  test("边界：刚好到期是 0，不足一秒也按一秒算", () => {
    expect(remainingCooldown(new Date("2026-01-01T00:00:00.000Z"), now)).toBe(
      0,
    );
    // 还剩 0.5 秒时不是 0：否则用户可以在冷却结束前重发。
    expect(remainingCooldown(new Date("2026-01-01T00:00:00.500Z"), now)).toBe(
      1,
    );
    expect(remainingCooldown(new Date("2026-01-01T00:00:00.001Z"), now)).toBe(
      1,
    );
  });

  test("边界：长时间冷却不溢出、不变成小数", () => {
    const remaining = remainingCooldown(new Date("2026-01-02T00:00:00Z"), now);
    expect(remaining).toBe(24 * 60 * 60);
    expect(Number.isInteger(remaining)).toBe(true);
  });
});

test("冷却记录按邮箱归一化，并与验证码记录区分", () => {
  expect(cooldownIdentifier(" Ada@Example.com ")).toBe(
    "otp-resend-cooldown:ada@example.com",
  );
});

test("冷却记录的 identifier 与 emailOTP 插件的 <type>-otp-<email> 不重叠", () => {
  const identifier = cooldownIdentifier("ada@example.com");
  for (const type of ["sign-in", "change-email", "email-verification"]) {
    expect(identifier).not.toBe(`${type}-otp-ada@example.com`);
  }
  expect(identifier.startsWith("otp-resend-cooldown:")).toBe(true);
});

/** 发送接口的 before-hook：直接调用 handler，跳过 better-auth 的中间件装配。 */
function sendHook({
  seconds = 60,
  now,
}: { seconds?: number; now?: Date } = {}) {
  const plugin = otpResendCooldown({
    seconds,
    now: () => now ?? new Date("2026-01-01T00:00:00Z"),
  });
  const [hook] = (
    plugin.hooks as { before: { matcher: unknown; handler: unknown }[] }
  ).before;
  return hook!.handler as (ctx: unknown) => Promise<unknown>;
}

function sendPathMatcher() {
  const plugin = otpResendCooldown({ seconds: 60 });
  const [hook] = (
    plugin.hooks as { before: { matcher: unknown; handler: unknown }[] }
  ).before;
  return hook!.matcher as (ctx: { path: string }) => boolean;
}

function adapter(existing: { expiresAt: Date } | undefined) {
  const created: { identifier: string; expiresAt: Date }[] = [];
  const deleted: string[] = [];
  return {
    created,
    deleted,
    context: {
      internalAdapter: {
        findVerificationValue: async () => existing,
        deleteVerificationByIdentifier: async (identifier: string) => {
          deleted.push(identifier);
        },
        createVerificationValue: async (value: {
          identifier: string;
          expiresAt: Date;
        }) => {
          created.push(value);
        },
      },
    },
  };
}

describe("otpResendCooldown", () => {
  const send = {
    path: "/email-otp/send-verification-otp",
    body: { email: "ada@example.com" },
  };

  test("只拦发送接口", () => {
    const matches = sendPathMatcher();
    expect(matches({ path: "/email-otp/send-verification-otp" })).toBe(true);
    expect(matches({ path: "/sign-in/email-otp" })).toBe(false);
    expect(matches({ path: "/get-session" })).toBe(false);
  });

  test("没有冷却记录时放行并写下一条记录", async () => {
    const store = adapter(undefined);
    await sendHook()({ ...send, context: store.context });

    expect(store.deleted).toEqual([]);
    expect(store.created).toHaveLength(1);
    expect(store.created[0]!.identifier).toBe(
      "otp-resend-cooldown:ada@example.com",
    );
    // 记录的有效期就是冷却窗口。
    expect(store.created[0]!.expiresAt).toEqual(
      new Date("2026-01-01T00:01:00Z"),
    );
  });

  test("冷却中时抛 TOO_MANY_REQUESTS 并给出 Retry-After", async () => {
    const store = adapter({ expiresAt: new Date("2026-01-01T00:00:30Z") });
    const error = await sendHook()({ ...send, context: store.context }).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toMatchObject({
      status: "TOO_MANY_REQUESTS",
      body: {
        code: RESEND_COOLDOWN,
        message: "Please wait 30s before requesting a new code",
        retryAfter: 30,
      },
      // 客户端读 Retry-After 来显示倒计时。
      headers: { "Retry-After": "30" },
    });
    // 被拦下时什么都不写：不能把冷却窗口顺延。
    expect(store.created).toEqual([]);
    expect(store.deleted).toEqual([]);
  });

  test("冷却过期后删掉旧记录再写新的（过期不算冷却）", async () => {
    const store = adapter({ expiresAt: new Date("2025-12-31T23:59:00Z") });
    await sendHook()({ ...send, context: store.context });

    expect(store.deleted).toEqual(["otp-resend-cooldown:ada@example.com"]);
    expect(store.created).toHaveLength(1);
  });

  test("邮箱不是字符串（body 被改过）时直接放行", async () => {
    const store = adapter(undefined);
    await sendHook()({
      path: send.path,
      body: { email: 123 },
      context: store.context,
    });
    expect(store.created).toEqual([]);
    expect(store.deleted).toEqual([]);
  });

  test("没有 body 时直接放行", async () => {
    const store = adapter(undefined);
    await sendHook()({
      path: send.path,
      body: undefined,
      context: store.context,
    });
    expect(store.created).toEqual([]);
  });

  test("seconds <= 0 时插件不生效（配置成 0 就是不冷却）", async () => {
    const create = vi.fn();
    const store = adapter(undefined);
    await sendHook({ seconds: 0 })({
      ...send,
      context: {
        internalAdapter: {
          ...store.context.internalAdapter,
          createVerificationValue: create,
        },
      },
    });
    expect(create).not.toHaveBeenCalled();
  });

  test("冷却记录用邮箱归一化后的 key，大小写和空格不影响判定", async () => {
    const store = adapter({ expiresAt: new Date("2026-01-01T00:00:30Z") });
    await expect(
      sendHook()({
        path: send.path,
        body: { email: " ADA@example.COM " },
        context: store.context,
      }),
    ).rejects.toMatchObject({ body: { code: RESEND_COOLDOWN } });
  });
});
