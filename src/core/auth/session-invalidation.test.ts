import { describe, expect, test, vi } from "vitest";

import {
  EMAIL_CHANGE_PATH,
  emailChangeSucceeded,
  revokeSessionsOnEmailChange,
} from "./session-invalidation";

type FakeCtx = {
  path?: string;
  context: {
    returned?: unknown;
    session?: { user: { id: string } } | null;
    internalAdapter: { deleteUserSessions: () => Promise<void> };
  };
};

/** 取出插件注册的 after 钩子，按真实 ctx 的形状喂它。 */
function afterHook() {
  const hook = revokeSessionsOnEmailChange().hooks?.after?.[0];
  if (!hook) throw new Error("plugin registered no after hook");
  return hook as unknown as {
    matcher: (ctx: FakeCtx) => boolean;
    handler: (ctx: FakeCtx) => Promise<unknown>;
  };
}

function run({
  path = EMAIL_CHANGE_PATH,
  returned,
  userId = "user-1",
}: {
  path?: string;
  returned?: unknown;
  userId?: string | null;
}) {
  const deleteUserSessions = vi.fn(async () => {});
  const ctx: FakeCtx = {
    path,
    context: {
      returned,
      session: userId ? { user: { id: userId } } : null,
      internalAdapter: { deleteUserSessions },
    },
  };
  const hook = afterHook();
  const matched = hook.matcher(ctx);
  return (async () => {
    if (matched) await hook.handler(ctx);
    return deleteUserSessions;
  })();
}

describe("emailChangeSucceeded", () => {
  test("只看端点的 success 字段", () => {
    expect(emailChangeSucceeded({ success: true })).toBe(true);
    expect(emailChangeSucceeded({ success: false })).toBe(false);
    // 端点出错时 after 钩子照样会跑，此时的 returned 是 APIError 或 undefined。
    expect(emailChangeSucceeded(undefined)).toBe(false);
    expect(emailChangeSucceeded(new Error("boom"))).toBe(false);
    expect(emailChangeSucceeded(null)).toBe(false);
  });
});

describe("revokeSessionsOnEmailChange", () => {
  test("只在改邮箱端点成功后作废该用户的全部 session", async () => {
    const deleteUserSessions = await run({ returned: { success: true } });
    expect(deleteUserSessions).toHaveBeenCalledTimes(1);
    expect(deleteUserSessions).toHaveBeenCalledWith("user-1");
  });

  test("端点失败时不动 session", async () => {
    // 输错验证码、新邮箱已被占用等都会走到这里；此时邮箱没改，session 不该被踢。
    expect(await run({ returned: { success: false } })).not.toHaveBeenCalled();
    expect(await run({ returned: undefined })).not.toHaveBeenCalled();
  });

  test("别的端点不受影响", async () => {
    // 登录、发验证码这些端点也返回 { success: true }，靠路径把它们排除在外。
    expect(
      await run({
        path: "/email-otp/send-verification-otp",
        returned: { success: true },
      }),
    ).not.toHaveBeenCalled();
  });

  test("读不到 session 时什么也不做", async () => {
    expect(
      await run({ returned: { success: true }, userId: null }),
    ).not.toHaveBeenCalled();
  });
});
