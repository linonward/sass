import { describe, expect, test } from "vitest";

import { resolvePostSignInPath } from "./landing";

const base = {
  callbackURL: "/dashboard",
  onboardingPath: "/onboarding",
};

describe("resolvePostSignInPath", () => {
  test("还没走完清单的用户落到引导页", () => {
    expect(
      resolvePostSignInPath({
        ...base,
        user: { id: "u1", onboardingCompleted: false },
      }),
    ).toBe("/onboarding");
  });

  test("已完成的用户原样去目标页：不多一次跳转", () => {
    expect(
      resolvePostSignInPath({
        ...base,
        user: { id: "u1", onboardingCompleted: true },
      }),
    ).toBe("/dashboard");
  });

  test("读不到这个字段时按已完成处理，不把老用户丢回引导页", () => {
    for (const user of [{ id: "u1" }, null, undefined, "not-an-object"]) {
      expect(resolvePostSignInPath({ ...base, user })).toBe("/dashboard");
    }
    expect(
      resolvePostSignInPath({
        ...base,
        user: { onboardingCompleted: "false" },
      }),
    ).toBe("/dashboard");
  });

  test("带了 callbackURL 的登录一律尊重原目标（深链优先）", () => {
    expect(
      resolvePostSignInPath({
        callbackURL: "/dashboard?from=e2e",
        onboardingPath: null,
        user: { onboardingCompleted: false },
      }),
    ).toBe("/dashboard?from=e2e");
  });
});
