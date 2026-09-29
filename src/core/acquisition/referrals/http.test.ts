// @vitest-environment node
import type { NextResponse } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  referralFromHeaders,
  REFERRAL_COOKIE,
  REFERRAL_SECONDS,
  signContext,
} from "../tokens";
import { newReferralCode } from "./code";
import { createReferralHandlers } from "./http";

const secret = "test-referral-http-secret";
const url = "http://localhost:3300/api/acquisition/referrals";
const code = newReferralCode();
const inviter = { userId: "inviter", name: "Inviter" };
const resolveInviter = vi.fn();
const relationshipFor = vi.fn();
const getUserId = vi.fn();
const limit = vi.fn();
const handlers = (enabled = true) =>
  createReferralHandlers({
    enabled,
    secret,
    getUserId,
    limit,
    service: { resolveInviter, relationshipFor },
  });
const request = (
  body: unknown,
  cookie = "",
  origin = "http://localhost:3300",
) =>
  new Request(url, {
    method: "POST",
    headers: { origin, "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
const signed = (value: string) =>
  signContext(
    { v: 1, purpose: "referral", code: value, acceptedAt: Date.now() },
    secret,
  );
/**
 * POST returns a union: the normal path is a NextResponse from `json()`, the rate-limited path is a
 * Response from `rateLimitResponse()` (the shared kit doesn't depend on Next). Cookies only exist
 * on the former, so narrow before asserting.
 */
const cookies = (response: Response) => (response as NextResponse).cookies;

beforeEach(() => {
  vi.resetAllMocks();
  resolveInviter.mockResolvedValue(inviter);
  relationshipFor.mockResolvedValue(null);
  getUserId.mockResolvedValue(null);
  limit.mockResolvedValue({ ok: true, retryAfter: 0 });
});

describe("referral API", () => {
  test("returns 404 when the module is off, without looking anything up", async () => {
    const response = await handlers(false).POST(
      request({ action: "accept", code }),
    );
    expect(response.status).toBe(404);
    expect(resolveInviter).not.toHaveBeenCalled();
    expect(getUserId).not.toHaveBeenCalled();
  });

  test("only accepts same-origin JSON; unknown fields and bad codes are rejected outright", async () => {
    expect(
      (
        await handlers().POST(
          request({ action: "decline" }, "", "https://evil.test"),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handlers().POST(
          new Request(url, {
            method: "POST",
            headers: {
              origin: "http://localhost:3300",
              "content-type": "text/plain",
            },
            body: "{}",
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (await handlers().POST(request({ action: "accept", code, userId: "x" })))
        .status,
    ).toBe(400);
    // A malformed code never hits the database: the client can't smuggle in arbitrary strings.
    const malformed = await handlers().POST(
      request({ action: "accept", code: "not-a-code" }),
    );
    expect(malformed.status).toBe(400);
    expect(resolveInviter).not.toHaveBeenCalled();
    // Bad requests shouldn't consume rate limit quota either.
    expect(limit).not.toHaveBeenCalled();
  });

  test("rate limits by client IP: rejected with 429 + Retry-After, without a database lookup", async () => {
    limit.mockResolvedValue({ ok: false, reason: "limited", retryAfter: 42 });
    const response = await handlers().POST(request({ action: "accept", code }));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
    expect(await response.json()).toEqual({ error: "rate_limited" });
    expect(resolveInviter).not.toHaveBeenCalled();
  });

  test("503 when Redis is unavailable (self-hosted misconfiguration), rather than silently allowing", async () => {
    limit.mockResolvedValue({
      ok: false,
      reason: "unavailable",
      retryAfter: 0,
    });
    const response = await handlers().POST(request({ action: "accept", code }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
    expect(resolveInviter).not.toHaveBeenCalled();
  });

  test("rate limit counts by the first XFF hop; decline and an existing context don't count", async () => {
    await handlers().POST(
      new Request(url, {
        method: "POST",
        headers: {
          origin: "http://localhost:3300",
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.7, 70.41.3.18",
        },
        body: JSON.stringify({ action: "accept", code }),
      }),
    );
    expect(limit).toHaveBeenCalledWith("203.0.113.7");

    limit.mockClear();
    await handlers().POST(request({ action: "decline" }));
    expect(limit).not.toHaveBeenCalled();

    // With an existing referral context the old code is returned directly, no database lookup is
    // needed, and so it shouldn't use quota either.
    await handlers().POST(
      request(
        { action: "accept", code },
        `${REFERRAL_COOKIE}=${signed(newReferralCode())}`,
      ),
    );
    expect(limit).not.toHaveBeenCalled();
  });

  test("unknown or banned inviters are always invalid and no cookie is written", async () => {
    resolveInviter.mockResolvedValue(null);
    const response = await handlers().POST(request({ action: "accept", code }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid" });
    expect(cookies(response).get(REFERRAL_COOKIE)).toBeUndefined();
  });

  test("accepting a valid invite writes an httpOnly lax cookie that reads back as that code", async () => {
    const response = await handlers().POST(request({ action: "accept", code }));
    expect(response.status).toBe(200);
    const cookie = cookies(response).get(REFERRAL_COOKIE);
    expect(cookie).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      maxAge: REFERRAL_SECONDS,
    });
    // The server reads the same code back from the written cookie.
    expect(
      referralFromHeaders(
        new Headers({ cookie: `${REFERRAL_COOKIE}=${cookie?.value}` }),
        secret,
      )?.code,
    ).toBe(code);
    // Copied codes tolerate whitespace and case.
    const loose = await handlers().POST(
      request({ action: "accept", code: `  ${code.toUpperCase()} ` }),
    );
    expect(await loose.json()).toEqual({ accepted: true, code });
  });

  test("the first accepted code wins: an existing context isn't overwritten", async () => {
    const first = newReferralCode();
    const response = await handlers().POST(
      request(
        { action: "accept", code },
        `${REFERRAL_COOKIE}=${signed(first)}`,
      ),
    );
    expect(await response.json()).toEqual({ accepted: true, code: first });
    expect(cookies(response).get(REFERRAL_COOKIE)).toBeUndefined();
    expect(resolveInviter).not.toHaveBeenCalled();
  });

  test("rejects self-referral and the user's own account: the client can't decide attribution", async () => {
    getUserId.mockResolvedValue(inviter.userId);
    const self = await handlers().POST(request({ action: "accept", code }));
    expect(self.status).toBe(400);
    expect(await self.json()).toEqual({ error: "self" });
    expect(cookies(self).get(REFERRAL_COOKIE)).toBeUndefined();

    getUserId.mockResolvedValue("invitee");
    relationshipFor.mockResolvedValue({
      status: "awaiting_payment",
      createdAt: new Date(),
    });
    const bound = await handlers().POST(request({ action: "accept", code }));
    expect(bound.status).toBe(400);
    expect(await bound.json()).toEqual({ error: "bound" });
    expect(cookies(bound).get(REFERRAL_COOKIE)).toBeUndefined();
  });

  test("declining an invite clears the context", async () => {
    const response = await handlers().POST(
      request(
        { action: "decline" },
        `${REFERRAL_COOKIE}=${signed(newReferralCode())}`,
      ),
    );
    expect(await response.json()).toEqual({ accepted: false });
    expect(cookies(response).get(REFERRAL_COOKIE)).toMatchObject({ maxAge: 0 });
  });
});
