// @vitest-environment node
import { describe, expect, test, vi } from "vitest";

import { identifySessionUser, sessionUserId } from "./identify";

const identifyUser = vi.hoisted(() => vi.fn());

vi.mock("@/core/observability/sentry", () => ({ identifyUser }));

describe("sessionUserId", () => {
  test.each([
    [{ user: { id: "user_1" } }, "user_1"],
    // get-session 未登录时返回 { user: null, session: null }。
    [{ user: null, session: null }, null],
    [{ user: {} }, null],
    [{ user: { id: 42 } }, null],
    [{}, null],
    [null, null],
    [undefined, null],
    ["user_1", null],
    [new Response(null), null],
  ])("%o 取出 %s", (returned, expected) => {
    expect(sessionUserId(returned)).toBe(expected);
  });
});

describe("identifySessionUser 插件", () => {
  function afterHook() {
    const plugin = identifySessionUser();
    const [hook] = (
      plugin.hooks as { after: { matcher: unknown; handler: unknown }[] }
    ).after;
    if (!hook) throw new Error("插件没有 after hook");
    return {
      matcher: hook.matcher as (context: { path: string }) => boolean,
      handler: hook.handler as (ctx: unknown) => Promise<unknown>,
    };
  }

  test("只挂在 get-session 上", () => {
    expect(afterHook().matcher({ path: "/get-session" })).toBe(true);
    expect(afterHook().matcher({ path: "/sign-in/email-otp" })).toBe(false);
  });

  test("登录后把用户 ID 交给 Sentry scope", async () => {
    identifyUser.mockClear();
    await afterHook().handler({
      context: { returned: { user: { id: "user_1" } } },
    });
    expect(identifyUser).toHaveBeenCalledWith("user_1");
  });

  test("未登录时清掉（userId 为 null，而不是不调用）", async () => {
    identifyUser.mockClear();
    await afterHook().handler({ context: { returned: { user: null } } });
    expect(identifyUser).toHaveBeenCalledWith(null);
  });
});
