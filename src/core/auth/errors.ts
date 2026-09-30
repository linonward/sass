// Custom sign-in error codes. Shared by the server and the sign-in page, so don't import server code
// here.

/** The resend cooldown for this email is still active. */
export const RESEND_COOLDOWN = "RESEND_COOLDOWN";

/** The verification code email could not be sent. */
export const EMAIL_SEND_FAILED = "EMAIL_SEND_FAILED";

/** The error shape Better Auth's client returns, plus our cooldown's `retryAfter`. */
export type AuthError = {
  code?: string;
  status?: number;
  retryAfter?: number;
};

/** A key under `Auth.errors` in messages, with its values. */
export type AuthErrorMessage =
  | {
      key:
        | "invalidCode"
        | "codeExpired"
        | "tooManyAttempts"
        | "banned"
        | "sendFailed"
        | "sendFailedGoogle"
        | "rateLimited"
        | "generic";
    }
  | { key: "cooldown"; values: { seconds: number } };

/**
 * Which message to show for a failed code request or verification. Shared by the sign-in page and
 * the change-email form so both describe the same codes the same way.
 */
export function authErrorMessage(
  error: AuthError,
  options: { resendCooldown: number; googleEnabled?: boolean },
): AuthErrorMessage {
  switch (error.code) {
    case "INVALID_OTP":
      return { key: "invalidCode" };
    case "OTP_EXPIRED":
      return { key: "codeExpired" };
    case "TOO_MANY_ATTEMPTS":
      return { key: "tooManyAttempts" };
    case "BANNED_USER":
      return { key: "banned" };
    case RESEND_COOLDOWN:
      return {
        key: "cooldown",
        values: { seconds: error.retryAfter ?? options.resendCooldown },
      };
    case EMAIL_SEND_FAILED:
      return { key: options.googleEnabled ? "sendFailedGoogle" : "sendFailed" };
  }
  if (error.status === 429) return { key: "rateLimited" };
  return { key: "generic" };
}
