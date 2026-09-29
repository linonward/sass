// @vitest-environment node
import { describe, expect, test, vi } from "vitest";

import { identifySessionUser, sessionUserId } from "./identify";

const identifyUser = vi.hoisted(() => vi.fn());

vi.mock("@/core/observability/sentry", () => ({ identifyUser }));

describe("sessionUserId", () => {
  test.each([
    [{ user: { id: "user_1" } }, "user_1"],
    // get-session returns { user: null, session: null } when signed out.
    [{ user: null, session: null }, null],
    [{ user: {} }, null],
    [{ user: { id: 42 } }, null],
    [{}, null],
    [null, null],
    [undefined, null],
    ["user_1", null],
    [new Response(null), null],
  ])("%o yields %s", (returned, expected) => {
    expect(sessionUserId(returned)).toBe(expected);
  });
});

describe("identifySessionUser plugin", () => {
  function afterHook() {
    const plugin = identifySessionUser();
    const [hook] = (
      plugin.hooks as { after: { matcher: unknown; handler: unknown }[] }
    ).after;
    if (!hook) throw new Error("plugin has no after hook");
    return {
      matcher: hook.matcher as (context: { path: string }) => boolean,
      handler: hook.handler as (ctx: unknown) => Promise<unknown>,
    };
  }

  test("only hooks into get-session", () => {
    expect(afterHook().matcher({ path: "/get-session" })).toBe(true);
    expect(afterHook().matcher({ path: "/sign-in/email-otp" })).toBe(false);
  });

  test("passes the user ID to the Sentry scope when signed in", async () => {
    identifyUser.mockClear();
    await afterHook().handler({
      context: { returned: { user: { id: "user_1" } } },
    });
    expect(identifyUser).toHaveBeenCalledWith("user_1");
  });

  test("clears it when signed out (called with null rather than not called)", async () => {
    identifyUser.mockClear();
    await afterHook().handler({ context: { returned: { user: null } } });
    expect(identifyUser).toHaveBeenCalledWith(null);
  });
});
