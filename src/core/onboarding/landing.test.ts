import { describe, expect, test } from "vitest";

import { resolvePostSignInPath } from "./landing";

const base = {
  callbackURL: "/dashboard",
  onboardingPath: "/onboarding",
};

describe("resolvePostSignInPath", () => {
  test("users who haven't finished the checklist land on the onboarding page", () => {
    expect(
      resolvePostSignInPath({
        ...base,
        user: { id: "u1", onboardingCompleted: false },
      }),
    ).toBe("/onboarding");
  });

  test("users who are done go straight to the target: no extra redirect", () => {
    expect(
      resolvePostSignInPath({
        ...base,
        user: { id: "u1", onboardingCompleted: true },
      }),
    ).toBe("/dashboard");
  });

  test("a missing field counts as done, so existing users aren't sent back to onboarding", () => {
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

  test("sign-ins with a callbackURL always honor the original target (deep links win)", () => {
    expect(
      resolvePostSignInPath({
        callbackURL: "/dashboard?from=e2e",
        onboardingPath: null,
        user: { onboardingCompleted: false },
      }),
    ).toBe("/dashboard?from=e2e");
  });
});
