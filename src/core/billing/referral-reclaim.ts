import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type {
  ReclaimInput,
  ReclaimResult,
  WriteOptions,
} from "@/core/credits/service";
import {
  referralRelationships,
  referralRewardDebt,
  referralRewards,
} from "@/core/db/schema";
import { logger } from "@/core/observability/logger";

import type { OnBillingEventHandler } from "./on-billing-event";

export const REFERRAL_RECLAIM_SOURCE = "referral-refund";

function referralReclaimSourceId(
  provider: string,
  orderId: string,
  refundId: string,
  role: "inviter" | "invitee",
) {
  return `${provider}:order:${orderId}:refund:${refundId}:referral:${role}`;
}

/**
 * onBillingEvent hook that reclaims referral rewards on refund.
 * Trigger: refund.created.
 *
 * A partial or full refund cancels all of both sides' rewards for that order (not proportional).
 * If the balance is too low to reclaim, the shortfall is recorded as debt in referral_reward_debt.
 */
export function createReferralReclaimHandler({
  enabled,
  reclaimCredits,
  rewardsEnabled,
}: {
  enabled: boolean;
  reclaimCredits: (
    input: ReclaimInput,
    options: WriteOptions,
  ) => Promise<ReclaimResult>;
  rewardsEnabled: boolean;
}): OnBillingEventHandler {
  return async (event, { tx }) => {
    if (!enabled || !rewardsEnabled) return;
    if (event.type !== "refund.created") return;

    const orderRef = `${event.provider}:${event.orderId}`;

    // Find the grant records for this order
    const [reward] = await tx
      .select({
        id: referralRewards.id,
        inviterUserId: referralRewards.inviterUserId,
        inviteeUserId: referralRewards.inviteeUserId,
        inviterCredits: referralRewards.inviterCredits,
        inviteeCredits: referralRewards.inviteeCredits,
        inviterGrantSourceId: referralRewards.inviterGrantSourceId,
        inviteeGrantSourceId: referralRewards.inviteeGrantSourceId,
      })
      .from(referralRewards)
      .where(
        and(
          eq(referralRewards.orderRef, orderRef),
          eq(referralRewards.type, "granted"),
        ),
      );

    if (!reward) return;

    // Reclaim both sides' rewards (in full, not proportional)
    const reclaims = [
      {
        userId: reward.inviterUserId,
        credits: reward.inviterCredits,
        role: "inviter" as const,
      },
      {
        userId: reward.inviteeUserId,
        credits: reward.inviteeCredits,
        role: "invitee" as const,
      },
    ];

    for (const { userId, credits, role } of reclaims) {
      if (!credits || credits <= 0 || !userId) continue;

      const sourceId = referralReclaimSourceId(
        event.provider,
        event.orderId,
        event.refundId,
        role,
      );

      const result = await reclaimCredits(
        {
          userId,
          amount: credits,
          source: REFERRAL_RECLAIM_SOURCE,
          sourceId,
          reason: `Referral reward revoked for ${event.provider} refund ${event.refundId}`,
        },
        { tx },
      );

      if (result.shortfall > 0) {
        logger.warn("referrals.reclaim_shortfall", {
          userId,
          role,
          owed: credits,
          reclaimed: result.reclaimed,
          shortfall: result.shortfall,
          orderRef,
          refundId: event.refundId,
        });

        // Record the debt
        await tx.insert(referralRewardDebt).values({
          id: randomUUID(),
          userId,
          rewardId: reward.id,
          amount: result.shortfall,
        });
      }
    }

    // Write the reversal record
    await tx.insert(referralRewards).values({
      id: randomUUID(),
      inviteeUserId: reward.inviteeUserId,
      inviterUserId: reward.inviterUserId,
      orderRef,
      type: "revoked",
    });

    // Update the relationship status
    await tx
      .update(referralRelationships)
      .set({ status: "revoked" })
      .where(eq(referralRelationships.inviteeUserId, reward.inviteeUserId));
  };
}
