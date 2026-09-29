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
  /**
   * Rate limit for the public endpoint (per IP), the same one the lead capture endpoint uses;
   * rejections return 429 / 503.
   */
  limit: (ip: string | null) => Promise<RateLimitResult>;
  service: Pick<
    ReturnType<typeof createReferralService>,
    "resolveInviter" | "relationshipFor"
  >;
};
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Accepts / declines an invite. Only writes the signed referral context cookie and never touches
 * accounts or attribution: the relationship is created when the account is first created, by
 * `user.create.after`, based on the signed-in identity and server-side storage. The client can
 * never choose who gets the reward.
 */
export function createReferralHandlers(deps: Dependencies) {
  return {
    async POST(request: Request) {
      if (!deps.enabled) return json({ error: "not_found" }, 404);
      // Same as the other acquisition endpoints: only accept same-origin JSON POSTs, so this can't
      // be used as a cross-site write endpoint.
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
      // The first accepted, valid referral code wins: an existing context is left untouched. This
      // step only verifies the signature without touching the database, so it runs before the rate
      // limit and repeated clicks don't burn quota.
      const accepted = referralFromHeaders(request.headers, deps.secret);
      if (accepted) return json({ accepted: true, code: accepted.code });
      // A public endpoint callable while signed out: like the lead capture endpoint, pass the rate
      // limit first, then query the database.
      const limit = await deps.limit(getClientIp(request.headers));
      if (!limit.ok) return rateLimitResponse(limit);
      const inviter = await deps.service.resolveInviter(code);
      if (!inviter) return json({ error: "invalid" }, 400);
      const userId = await deps.getUserId(request.headers);
      if (userId === inviter.userId) return json({ error: "self" }, 400);
      // An existing relationship can't be changed: existing accounts (here, accounts that signed up
      // earlier and are already bound) are rejected outright.
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
