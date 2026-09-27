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

describe("注册时绑定邀请人", () => {
  test("模块关闭、没有邀请上下文时不写关系", async () => {
    await run(false)("user-1", headers(referralCookie()));
    await run()("user-1", headers("other=1"));
    await run()("user-1", undefined);
    expect(bind).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  test("只提交码和登录身份，邀请人由服务端再查一次", async () => {
    bind.mockResolvedValue({ ok: true, inviterUserId: "inviter" });
    await run()("user-1", headers(referralCookie()));
    expect(bind).toHaveBeenCalledWith({ inviteeUserId: "user-1", code });
    expect(warn).not.toHaveBeenCalled();
  });

  test("归因上下文与绑定无关：只有邀请 cookie 时照样绑定", async () => {
    bind.mockResolvedValue({ ok: true, inviterUserId: "inviter" });
    const snapshot = captureEntry(
      { pathname: "/", utm_source: "launch" },
      "site.test",
    )!;
    const source = signContext(
      { v: 1, purpose: "source", attribution: snapshot },
      secret,
    );
    // 归因关闭的站点不会有 SOURCE_COOKIE，绑定不依赖它。
    await run()("user-1", headers(referralCookie()));
    expect(bind).toHaveBeenCalledTimes(1);
    // 同时带着归因上下文时，绑定读的还是邀请 cookie。
    await run()(
      "user-2",
      headers(`${SOURCE_COOKIE}=${source}; ${referralCookie()}`),
    );
    expect(bind).toHaveBeenCalledTimes(2);
    // 只有归因、没有邀请上下文时不绑定。
    await run()("user-3", headers(`${SOURCE_COOKIE}=${source}`));
    expect(bind).toHaveBeenCalledTimes(2);
  });

  test("拒绝的结果只告警，不影响注册", async () => {
    bind.mockResolvedValue({ ok: false, reason: "self" });
    await expect(
      run()("user-1", headers(referralCookie())),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("referrals.bind_rejected", {
      userId: "user-1",
      reason: "self",
    });
  });

  test("存储故障吞掉并告警，注册流程不失败", async () => {
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
