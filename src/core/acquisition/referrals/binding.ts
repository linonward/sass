import { referralFromHeaders } from "../tokens";
import type { createReferralService } from "./service";

/**
 * Binds the inviter at sign-up: only a signed referral context from the browser counts, and the
 * server looks up the code's inviter again (exists and isn't banned). A failed binding or an
 * invalid context must never affect the sign-up itself.
 */
export function createReferralBinding(deps: {
  enabled: boolean;
  secret: string;
  bind: ReturnType<typeof createReferralService>["bind"];
  warn: (event: string, fields?: Record<string, unknown>) => void;
}) {
  return async (userId: string, headers?: Headers) => {
    if (!deps.enabled) return;
    const pending = referralFromHeaders(headers, deps.secret);
    if (!pending) return;
    try {
      const result = await deps.bind({
        inviteeUserId: userId,
        code: pending.code,
      });
      if (!result.ok)
        deps.warn("referrals.bind_rejected", {
          userId,
          reason: result.reason,
        });
    } catch (error) {
      // The relationship only gets this one chance: on failure leave a warning so an operator can
      // decide whether to compensate.
      deps.warn("referrals.bind_failed", { error, userId });
    }
  };
}
