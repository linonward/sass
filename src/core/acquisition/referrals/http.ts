import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getClientIp,
  rateLimitResponse,
  type RateLimitResult,
} from "@/core/ratelimit/limiter";
import {
  cookieOptions,
  referralFromHeaders,
  REFERRAL_COOKIE,
  REFERRAL_SECONDS,
  signContext,
} from "../tokens";
import { readSmallBody } from "../request-body";
import { isReferralCode, normalizeReferralCode } from "./code";
import type { createReferralService } from "./service";

const inputSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("accept"), code: z.string().max(64) }),
  z.strictObject({ action: z.literal("decline") }),
]);
type Dependencies = {
  enabled: boolean;
  secret: string;
  getUserId: (headers: Headers) => Promise<string | null>;
  /** 公开接口的限流（按 IP），和留资入口同一套；拒绝时返回 429 / 503。 */
  limit: (ip: string | null) => Promise<RateLimitResult>;
  service: Pick<
    ReturnType<typeof createReferralService>,
    "resolveInviter" | "relationshipFor"
  >;
};
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * 接受/拒绝邀请。只写签名后的邀请上下文 Cookie，不涉及账号和归属：
 * 关系在首次创建账号时由 `user.create.after` 依据登录身份和服务端存储建立，
 * 客户端始终不能指定发奖用户。
 */
export function createReferralHandlers(deps: Dependencies) {
  return {
    async POST(request: Request) {
      if (!deps.enabled) return json({ error: "not_found" }, 404);
      // 与其余获客接口一致：只接受同源 JSON POST，避免被当成跨站写入点。
      if (
        request.headers.get("origin") !== new URL(request.url).origin ||
        request.headers.get("content-type")?.split(";")[0] !==
          "application/json"
      )
        return json({ error: "forbidden" }, 403);
      const parsed = inputSchema.safeParse(await readSmallBody(request));
      if (!parsed.success) return json({ error: "invalid" }, 400);
      if (parsed.data.action === "decline") {
        const response = json({ accepted: false });
        response.cookies.set(REFERRAL_COOKIE, "", {
          ...cookieOptions,
          maxAge: 0,
        });
        return response;
      }
      const code = normalizeReferralCode(parsed.data.code);
      if (!isReferralCode(code)) return json({ error: "invalid" }, 400);
      // 首个已接受且有效的邀请码胜出：已有上下文就保持不动。
      // 这一步只验签、不查库，放在限流前，重复点击不会白耗配额。
      const accepted = referralFromHeaders(request.headers, deps.secret);
      if (accepted) return json({ accepted: true, code: accepted.code });
      // 未登录也能调的公开接口：和留资入口一样先过限流，再查库。
      const limit = await deps.limit(getClientIp(request.headers));
      if (!limit.ok) return rateLimitResponse(limit);
      const inviter = await deps.service.resolveInviter(code);
      if (!inviter) return json({ error: "invalid" }, 400);
      const userId = await deps.getUserId(request.headers);
      if (userId === inviter.userId) return json({ error: "self" }, 400);
      // 已有关系不能再换：老账号（这里指早已注册且已被绑定的账号）直接拒绝。
      if (userId && (await deps.service.relationshipFor(userId)))
        return json({ error: "bound" }, 400);
      const response = json({ accepted: true, code });
      response.cookies.set(
        REFERRAL_COOKIE,
        signContext(
          {
            v: 1,
            purpose: "referral",
            code,
            acceptedAt: Date.now(),
          },
          deps.secret,
        ),
        { ...cookieOptions, maxAge: REFERRAL_SECONDS },
      );
      return response;
    },
  };
}
