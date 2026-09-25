import { APIError, createAuthMiddleware } from "better-auth/api";
import type { BetterAuthPlugin } from "better-auth";

import { RESEND_COOLDOWN } from "./errors";

const SEND_PATH = "/email-otp/send-verification-otp";

/** 冷却记录在 verification 表里的 identifier。前缀与插件的 `<type>-otp-<email>` 不重叠，任何邮箱都不会撞上。 */
export function cooldownIdentifier(email: string) {
  return `otp-resend-cooldown:${email.trim().toLowerCase()}`;
}

/** 距离下次可以发送还剩几秒；没有冷却时返回 0。 */
export function remainingCooldown(
  expiresAt: Date | undefined,
  now: Date,
): number {
  if (!expiresAt) return 0;
  return Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / 1000));
}

/**
 * 同一邮箱两次发送验证码之间的最短间隔。emailOTP 插件只有按 IP 的限流，
 * 没有按邮箱的重发冷却，所以在发送接口前加一层校验，冷却状态复用 verification 表。
 */
export function otpResendCooldown({
  seconds,
  now = () => new Date(),
}: {
  seconds: number;
  now?: () => Date;
}) {
  return {
    id: "otp-resend-cooldown",
    hooks: {
      before: [
        {
          matcher: (context) => context.path === SEND_PATH,
          handler: createAuthMiddleware(async (ctx) => {
            const email = (ctx.body as { email?: unknown } | undefined)?.email;
            if (typeof email !== "string" || seconds <= 0) return;

            const adapter = ctx.context.internalAdapter;
            const identifier = cooldownIdentifier(email);
            const existing = await adapter.findVerificationValue(identifier);
            const retryAfter = remainingCooldown(existing?.expiresAt, now());
            if (retryAfter > 0) {
              throw new APIError(
                "TOO_MANY_REQUESTS",
                {
                  code: RESEND_COOLDOWN,
                  message: `Please wait ${retryAfter}s before requesting a new code`,
                  retryAfter,
                },
                { "Retry-After": String(retryAfter) },
              );
            }

            if (existing)
              await adapter.deleteVerificationByIdentifier(identifier);
            const sentAt = now();
            await adapter.createVerificationValue({
              identifier,
              value: sentAt.toISOString(),
              expiresAt: new Date(sentAt.getTime() + seconds * 1000),
            });
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
