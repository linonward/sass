import { z } from "zod";

import type { Credits } from "@/core/credits";

/**
 * Transaction source for admin credit adjustments; sourceId is a request ID generated when the form
 * renders, so resubmissions take effect only once.
 */
export const ADMIN_ADJUST_SOURCE = "admin";

export const adjustCreditsInput = z.object({
  userId: z.string().min(1),
  amount: z.coerce
    .number()
    .int()
    .min(-1_000_000_000)
    .max(1_000_000_000)
    .refine((n) => n !== 0, "must not be zero"),
  // A reason is required; it's written to the transaction's reason.
  reason: z.string().trim().min(1).max(500),
  requestId: z.uuid(),
});

export type AdjustCreditsInput = z.input<typeof adjustCreditsInput>;

/**
 * An admin adjusts a user's credits: writes an adjust transaction, with actor_id recording the
 * acting admin. A negative adjustment can't take the balance below 0 (throws
 * InsufficientCreditsError).
 */
export async function adjustUserCredits(
  credits: Pick<Credits, "adjustCredits">,
  adminId: string,
  input: AdjustCreditsInput,
) {
  const { userId, amount, reason, requestId } = adjustCreditsInput.parse(input);
  return credits.adjustCredits({
    userId,
    amount,
    reason,
    source: ADMIN_ADJUST_SOURCE,
    sourceId: requestId,
    actorId: adminId,
  });
}
