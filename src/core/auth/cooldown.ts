import { APIError, createAuthMiddleware } from "better-auth/api";
import type { BetterAuthPlugin } from "better-auth";

import { RESEND_COOLDOWN } from "./errors";

const SEND_PATH = "/email-otp/send-verification-otp";

/**
 * The identifier of a cooldown record in the verification table. The prefix never overlaps the
 * plugin's `<type>-otp-<email>`, so no email can collide with it.
 */
export function cooldownIdentifier(email: string) {
  return `otp-resend-cooldown:${email.trim().toLowerCase()}`;
}

/** Seconds left until the next send is allowed; 0 when there is no cooldown. */
export function remainingCooldown(
  expiresAt: Date | undefined,
  now: Date,
): number {
  if (!expiresAt) return 0;
  return Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / 1000));
}

/**
 * Minimum interval between two verification code sends to the same email. The emailOTP plugin only
 * rate limits by IP and has no per-email resend cooldown, so this adds a check in front of the send
 * endpoint, storing the cooldown state in the verification table.
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
