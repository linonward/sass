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

describe("referral context", () => {
  test("signed round trip: reads back the code and accepted time", () => {
    const now = Date.now();
    expect(
      referralFromHeaders(
        headers(`${REFERRAL_COOKIE}=${token(now)}`),
        secret,
        now,
      ),
    ).toEqual({ code, acceptedAt: now });
  });

  test("30-day window: neither expired nor future times can be read", () => {
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

  test("a tampered signature, a different secret, or junk is not a referral context", () => {
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

  test("the code in the envelope must match the generated format; arbitrary strings can't be smuggled in", () => {
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

  test("referral context and channel UTM are stored separately: neither accepts the other or overwrites it", () => {
    const snapshot = captureEntry(
      { pathname: "/", utm_source: "launch", utm_campaign: "first" },
      "site.test",
    )!;
    const source = signContext(
      { v: 1, purpose: "source", attribution: snapshot },
      secret,
    );
    // Reading the attribution context as a referral, or the referral context as attribution, must
    // both yield nothing.
    expect(
      referralFromHeaders(headers(`${SOURCE_COOKIE}=${source}`), secret),
    ).toBeNull();
    expect(
      sourceFromHeaders(
        headers(`${REFERRAL_COOKIE}=${token(Date.now())}`),
        secret,
      ),
    ).toBeNull();
    // Each lives in its own cookie, independent of the other.
    expect(
      sourceFromHeaders(headers(`${SOURCE_COOKIE}=${source}`), secret),
    ).toEqual(snapshot);
  });
});
