import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";

/** The emailOTP plugin's change-email endpoint (exists once `changeEmail.enabled` is on). */
export const EMAIL_CHANGE_PATH = "/email-otp/change-email";

/**
 * Whether the endpoint actually finished changing the email. The endpoint returns
 * `{ success: true }`, but the after hook still runs on errors (dispatch puts the APIError into
 * `ctx.context.returned` as the return value), so trust only this field — "the hook ran" does not
 * mean success.
 */
export function emailChangeSucceeded(returned: unknown) {
  return (
    typeof returned === "object" &&
    returned !== null &&
    (returned as { success?: unknown }).success === true
  );
}

/**
 * After a successful email change, revoke all of the user's sessions (including the current one).
 *
 * The email is the account-recovery credential, so changing it swaps the way into the account:
 * anyone who held a session from before the change (an old device, a stolen cookie) must be signed
 * out immediately rather than keep access under the old identity. Afterwards the user signs in
 * again with the new email.
 *
 * Note that only the `/email-otp/change-email` endpoint is covered. The core link-based
 * `/change-email` (`user.changeEmail.enabled`) is not enabled in this repo and returns a different
 * shape (`{ status: true }`); if you enable it later, include it in this check as well.
 */
export function revokeSessionsOnEmailChange() {
  return {
    id: "revoke-sessions-on-email-change",
    hooks: {
      after: [
        {
          matcher: (context) => context.path === EMAIL_CHANGE_PATH,
          handler: createAuthMiddleware(async (ctx) => {
            if (!emailChangeSucceeded(ctx.context.returned)) return;
            const userId = ctx.context.session?.user.id;
            if (!userId) return;
            await ctx.context.internalAdapter.deleteUserSessions(userId);
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
