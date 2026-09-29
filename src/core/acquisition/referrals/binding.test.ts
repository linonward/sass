// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest";

import { captureEntry } from "../context";
import { REFERRAL_COOKIE, signContext, SOURCE_COOKIE } from "../tokens";
import { createReferralBinding } from "./binding";
import { newReferralCode } from "./code";

const secret = "test-referral-binding-secret";
const code = newReferralCode();
const referralCookie = (value = code) =>
  `${REFERRAL_COOKIE}=${signContext({ v: 1, purpose: "referral", code: value, acceptedAt: Date.now() }, secret)}`;
const headers = (cookie: string) => new Headers({ cookie });
const bind = vi.fn();
const warn = vi.fn();
const run = (enabled = true) =>
  createReferralBinding({ enabled, secret, bind, warn });

beforeEach(() => vi.resetAllMocks());

describe("binding the inviter at sign-up", () => {
  test("writes no relationship when the module is off or there is no referral context", async () => {
    await run(false)("user-1", headers(referralCookie()));
    await run()("user-1", headers("other=1"));
    await run()("user-1", undefined);
    expect(bind).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  test("only submits the code and signed-in identity; the server looks up the inviter again", async () => {
    bind.mockResolvedValue({ ok: true, inviterUserId: "inviter" });
    await run()("user-1", headers(referralCookie()));
    expect(bind).toHaveBeenCalledWith({ inviteeUserId: "user-1", code });
    expect(warn).not.toHaveBeenCalled();
  });

  test("attribution context is unrelated to binding: binds with only the referral cookie", async () => {
    bind.mockResolvedValue({ ok: true, inviterUserId: "inviter" });
    const snapshot = captureEntry(
      { pathname: "/", utm_source: "launch" },
      "site.test",
    )!;
    const source = signContext(
      { v: 1, purpose: "source", attribution: snapshot },
      secret,
    );
    // Sites with attribution off have no SOURCE_COOKIE; binding doesn't depend on it.
    await run()("user-1", headers(referralCookie()));
    expect(bind).toHaveBeenCalledTimes(1);
    // With an attribution context present too, binding still reads the referral cookie.
    await run()(
      "user-2",
      headers(`${SOURCE_COOKIE}=${source}; ${referralCookie()}`),
    );
    expect(bind).toHaveBeenCalledTimes(2);
    // With attribution but no referral context, nothing is bound.
    await run()("user-3", headers(`${SOURCE_COOKIE}=${source}`));
    expect(bind).toHaveBeenCalledTimes(2);
  });

  test("rejected results only warn and don't affect sign-up", async () => {
    bind.mockResolvedValue({ ok: false, reason: "self" });
    await expect(
      run()("user-1", headers(referralCookie())),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("referrals.bind_rejected", {
      userId: "user-1",
      reason: "self",
    });
  });

  test("storage failures are swallowed with a warning; sign-up doesn't fail", async () => {
    bind.mockRejectedValue(new Error("db down"));
    await expect(
      run()("user-1", headers(referralCookie())),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("referrals.bind_failed", {
      error: expect.any(Error),
      userId: "user-1",
    });
  });
});
