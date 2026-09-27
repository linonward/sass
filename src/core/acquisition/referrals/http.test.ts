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
 * POST 的返回类型是联合：正常路径是 `json()` 的 NextResponse，限流路径是
 * `rateLimitResponse()` 的 Response（共享套件不依赖 Next）。cookie 只在前者上，
 * 断言前收窄一下。
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
  test("模块关闭时返回 404，不查任何东西", async () => {
    const response = await handlers(false).POST(
      request({ action: "accept", code }),
    );
    expect(response.status).toBe(404);
    expect(resolveInviter).not.toHaveBeenCalled();
    expect(getUserId).not.toHaveBeenCalled();
  });

  test("只接受同源 JSON，未知字段和坏码直接拒绝", async () => {
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
    // 码格式不对时不查库：客户端塞不进任意字符串。
    const malformed = await handlers().POST(
      request({ action: "accept", code: "not-a-code" }),
    );
    expect(malformed.status).toBe(400);
    expect(resolveInviter).not.toHaveBeenCalled();
    // 坏请求也不该消耗限流配额。
    expect(limit).not.toHaveBeenCalled();
  });

  test("按客户端 IP 限流：被拒时 429 + Retry-After，且不查库", async () => {
    limit.mockResolvedValue({ ok: false, reason: "limited", retryAfter: 42 });
    const response = await handlers().POST(request({ action: "accept", code }));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
    expect(await response.json()).toEqual({ error: "rate_limited" });
    expect(resolveInviter).not.toHaveBeenCalled();
  });

  test("Redis 不可用时 503（自托管漏配），不静默放行", async () => {
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

  test("限流按 XFF 第一跳计数；decline 与已有上下文都不计数", async () => {
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

    // 已经有邀请上下文时直接回旧码，不需要再查库，自然也不该占配额。
    await handlers().POST(
      request(
        { action: "accept", code },
        `${REFERRAL_COOKIE}=${signed(newReferralCode())}`,
      ),
    );
    expect(limit).not.toHaveBeenCalled();
  });

  test("未知或已封禁的邀请人一律 invalid，不写 cookie", async () => {
    resolveInviter.mockResolvedValue(null);
    const response = await handlers().POST(request({ action: "accept", code }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid" });
    expect(cookies(response).get(REFERRAL_COOKIE)).toBeUndefined();
  });

  test("接受有效邀请：写 httpOnly lax cookie，读回来就是那个码", async () => {
    const response = await handlers().POST(request({ action: "accept", code }));
    expect(response.status).toBe(200);
    const cookie = cookies(response).get(REFERRAL_COOKIE);
    expect(cookie).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      maxAge: REFERRAL_SECONDS,
    });
    // 写进去的 cookie 能被服务端读回同一个码。
    expect(
      referralFromHeaders(
        new Headers({ cookie: `${REFERRAL_COOKIE}=${cookie?.value}` }),
        secret,
      )?.code,
    ).toBe(code);
    // 复制来的码容忍空白与大小写。
    const loose = await handlers().POST(
      request({ action: "accept", code: `  ${code.toUpperCase()} ` }),
    );
    expect(await loose.json()).toEqual({ accepted: true, code });
  });

  test("首个已接受的邀请码胜出：已有上下文时不覆盖", async () => {
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

  test("自邀和自己的账号都拒绝：客户端不能自己决定归属", async () => {
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

  test("拒绝邀请会清掉上下文", async () => {
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
