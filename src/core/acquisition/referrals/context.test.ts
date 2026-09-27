// @vitest-environment node
import { describe, expect, test } from "vitest";

import { captureEntry } from "../context";
import {
  referralFromHeaders,
  REFERRAL_COOKIE,
  REFERRAL_SECONDS,
  signContext,
  sourceFromHeaders,
  SOURCE_COOKIE,
} from "../tokens";
import { newReferralCode } from "./code";

const secret = "test-referral-context-secret";
const code = newReferralCode();
const token = (acceptedAt: number) =>
  signContext({ v: 1, purpose: "referral", code, acceptedAt }, secret);
const headers = (cookie: string) => new Headers({ cookie });

describe("邀请上下文", () => {
  test("签名往返：读回码与接受时间", () => {
    const now = Date.now();
    expect(
      referralFromHeaders(
        headers(`${REFERRAL_COOKIE}=${token(now)}`),
        secret,
        now,
      ),
    ).toEqual({ code, acceptedAt: now });
  });

  test("30 天窗口：过期和未来时间都读不到", () => {
    const now = Date.now();
    const value = token(now);
    const cookie = `${REFERRAL_COOKIE}=${value}`;
    expect(
      referralFromHeaders(
        headers(cookie),
        secret,
        now + REFERRAL_SECONDS * 1000,
      ),
    ).toBeNull();
    expect(
      referralFromHeaders(
        headers(cookie),
        secret,
        now + REFERRAL_SECONDS * 1000 - 1,
      ),
    ).not.toBeNull();
    expect(
      referralFromHeaders(
        headers(`${REFERRAL_COOKIE}=${token(now + 1000)}`),
        secret,
        now,
      ),
    ).toBeNull();
  });

  test("改过签名、换了 secret、垃圾值都不是邀请上下文", () => {
    const forged = token(Date.now()).replace(/.$/, "x");
    expect(
      referralFromHeaders(headers(`${REFERRAL_COOKIE}=${forged}`), secret),
    ).toBeNull();
    expect(
      referralFromHeaders(
        headers(`${REFERRAL_COOKIE}=${token(Date.now())}`),
        "another-secret",
      ),
    ).toBeNull();
    expect(
      referralFromHeaders(headers(`${REFERRAL_COOKIE}=forged`), secret),
    ).toBeNull();
    expect(referralFromHeaders(new Headers(), secret)).toBeNull();
  });

  test("信封里的码必须符合生成格式，任意字符串塞不进去", () => {
    const value = signContext(
      {
        v: 1,
        purpose: "referral",
        code: "i-am-not-a-code",
        acceptedAt: Date.now(),
      },
      secret,
    );
    expect(
      referralFromHeaders(headers(`${REFERRAL_COOKIE}=${value}`), secret),
    ).toBeNull();
  });

  test("邀请上下文与渠道 UTM 分开存：两者互不认，也不会互相覆盖", () => {
    const snapshot = captureEntry(
      { pathname: "/", utm_source: "launch", utm_campaign: "first" },
      "site.test",
    )!;
    const source = signContext(
      { v: 1, purpose: "source", attribution: snapshot },
      secret,
    );
    // 归因上下文当成邀请读、邀请上下文当成归因读，都必须为空。
    expect(
      referralFromHeaders(headers(`${SOURCE_COOKIE}=${source}`), secret),
    ).toBeNull();
    expect(
      sourceFromHeaders(
        headers(`${REFERRAL_COOKIE}=${token(Date.now())}`),
        secret,
      ),
    ).toBeNull();
    // 各自存在自己的 cookie 里，互不影响。
    expect(
      sourceFromHeaders(headers(`${SOURCE_COOKIE}=${source}`), secret),
    ).toEqual(snapshot);
  });
});
