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
 * 退款时回收推荐奖励的 onBillingEvent 钩子。
 * 触发条件：refund.created。
 *
 * 部分或全额退款都取消该订单对应的全部双方奖励（不做比例）。
 * 回收时余额不够则记录债务到 referral_reward_debt。
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

    // 查找该订单的发放记录
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

    // 回收双方奖励（全额回收，不做比例）
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

        // 记债
        await tx.insert(referralRewardDebt).values({
          id: randomUUID(),
          userId,
          rewardId: reward.id,
          amount: result.shortfall,
        });
      }
    }

    // 写撤销记录
    await tx.insert(referralRewards).values({
      id: randomUUID(),
      inviteeUserId: reward.inviteeUserId,
      inviterUserId: reward.inviterUserId,
      orderRef,
      type: "revoked",
    });

    // 更新关系状态
    await tx
      .update(referralRelationships)
      .set({ status: "revoked" })
      .where(eq(referralRelationships.inviteeUserId, reward.inviteeUserId));
  };
}
