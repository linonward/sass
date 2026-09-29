import { and, eq, gte, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { SiteConfig } from "@/core/config/schema";
import type { GrantInput, WriteOptions } from "@/core/credits/service";
import type { DbTransaction } from "@/core/db";
import { referralRelationships, referralRewards, user } from "@/core/db/schema";
import { logger } from "@/core/observability/logger";

import type { OnBillingEventHandler } from "./on-billing-event";
import {
  getRewardRule,
  isOrderEligible,
  isRewardActive,
} from "../acquisition/referrals/rewards-config";
import { repayReferralDebts } from "../acquisition/referrals/rewards";

export const REFERRAL_GRANT_SOURCE = "referral";

function referralGrantSourceId(
  provider: string,
  orderId: string,
  role: "inviter" | "invitee",
) {
  return `${provider}:order:${orderId}:referral:${role}`;
}

function activeBan(
  row: { banned: boolean | null; banExpires: Date | null },
  now: Date,
) {
  if (row.banned !== true) return false;
  return !row.banExpires || row.banExpires.getTime() >= now.getTime();
}

async function inviterRewardsInPeriod(
  tx: DbTransaction,
  inviterUserId: string,
  since: Date,
): Promise<number> {
  const [row] = await tx
    .select({
      total: sql<number>`coalesce(sum(${referralRewards.inviterCredits}), 0)`,
    })
    .from(referralRewards)
    .where(
      and(
        eq(referralRewards.inviterUserId, inviterUserId),
        eq(referralRewards.type, "granted"),
        gte(referralRewards.createdAt, since),
      ),
    );
  return row?.total ?? 0;
}

/**
 * onBillingEvent hook that grants referral rewards.
 *
 * Runs atomically inside the event transaction: look up the relationship → validate rules → grant
 * credits to both sides → advance the status → pay off old debt.
 * Duplicates are blocked by the unique (source, sourceId) constraint on credit_transactions.
 */
export function createReferralGrantHandler({
  enabled,
  grantCredits,
  config,
}: {
  enabled: boolean;
  grantCredits: (input: GrantInput, options: WriteOptions) => Promise<unknown>;
  config: { acquisition: SiteConfig["acquisition"] };
}): OnBillingEventHandler {
  const rule = getRewardRule(config);
  const rewardsEnabled = enabled && isRewardActive(rule);

  return async (event, { tx, userId }) => {
    if (!rewardsEnabled) return;
    if (
      event.type !== "checkout.completed" &&
      event.type !== "subscription.renewed"
    )
      return;
    if (
      event.type === "checkout.completed" &&
      (!event.orderId || event.subscriptionId)
    )
      return;

    // Find the referral relationship
    const [rel] = await tx
      .select({
        inviteeUserId: referralRelationships.inviteeUserId,
        inviterUserId: referralRelationships.inviterUserId,
        status: referralRelationships.status,
        ruleSnapshot: referralRelationships.ruleSnapshot,
      })
      .from(referralRelationships)
      .where(
        and(
          eq(referralRelationships.inviteeUserId, userId),
          eq(referralRelationships.status, "awaiting_payment"),
        ),
      );

    if (!rel) return;

    // Frozen rules: prefer the snapshot taken when the relationship was created
    const frozenRule = (rel.ruleSnapshot as typeof rule | null) ?? rule;
    if (!isRewardActive(frozenRule)) return;

    // Check that the referrer isn't banned
    const [inviter] = await tx
      .select({ id: user.id, banned: user.banned, banExpires: user.banExpires })
      .from(user)
      .where(eq(user.id, rel.inviterUserId));
    if (!inviter || activeBan(inviter, new Date())) return;

    const now = new Date();

    // Daily/monthly cap check
    if (frozenRule.dailyCapPerInviter) {
      const dayStart = new Date(now);
      dayStart.setUTCHours(0, 0, 0, 0);
      const dayTotal = await inviterRewardsInPeriod(
        tx,
        rel.inviterUserId,
        dayStart,
      );
      if (
        dayTotal + frozenRule.inviterCredits >
        frozenRule.dailyCapPerInviter
      ) {
        logger.info("referrals.grant_capped_daily", {
          inviterUserId: rel.inviterUserId,
        });
        return;
      }
    }

    if (frozenRule.monthlyCapPerInviter) {
      const monthStart = new Date(now);
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);
      const monthTotal = await inviterRewardsInPeriod(
        tx,
        rel.inviterUserId,
        monthStart,
      );
      if (
        monthTotal + frozenRule.inviterCredits >
        frozenRule.monthlyCapPerInviter
      ) {
        logger.info("referrals.grant_capped_monthly", {
          inviterUserId: rel.inviterUserId,
        });
        return;
      }
    }

    // Check the plan and the minimum payment amount (available on the event)
    const planId =
      "planId" in event ? (event as { planId?: string }).planId : undefined;
    const orderAmount =
      "orderAmount" in event
        ? (event as { orderAmount?: number }).orderAmount
        : undefined;
    const currency =
      "currency" in event
        ? (event as { currency?: string }).currency
        : undefined;
    if (
      orderAmount != null &&
      currency &&
      planId &&
      !isOrderEligible(frozenRule, planId, orderAmount, currency)
    ) {
      return;
    }

    const orderId =
      "orderId" in event
        ? (event as { orderId: string }).orderId
        : event.eventId;
    const provider = event.provider;
    const rewardId = randomUUID();

    // Grant credits to both sides (inside the transaction; any failure rolls everything back)
    if (frozenRule.inviterCredits > 0) {
      await grantCredits(
        {
          userId: rel.inviterUserId,
          amount: frozenRule.inviterCredits,
          source: REFERRAL_GRANT_SOURCE,
          sourceId: referralGrantSourceId(provider, orderId, "inviter"),
          reason: `Referral reward for ${provider} order ${orderId}`,
        },
        { tx },
      );
    }

    if (frozenRule.inviteeCredits > 0) {
      await grantCredits(
        {
          userId,
          amount: frozenRule.inviteeCredits,
          source: REFERRAL_GRANT_SOURCE,
          sourceId: referralGrantSourceId(provider, orderId, "invitee"),
          reason: `Referral reward for ${provider} order ${orderId}`,
        },
        { tx },
      );
    }

    // Write the reward records
    await tx.insert(referralRewards).values({
      id: rewardId,
      inviteeUserId: userId,
      inviterUserId: rel.inviterUserId,
      orderRef: `${provider}:${orderId}`,
      type: "granted",
      inviterCredits: frozenRule.inviterCredits,
      inviteeCredits: frozenRule.inviteeCredits,
      inviterGrantSourceId:
        frozenRule.inviterCredits > 0
          ? referralGrantSourceId(provider, orderId, "inviter")
          : null,
      inviteeGrantSourceId:
        frozenRule.inviteeCredits > 0
          ? referralGrantSourceId(provider, orderId, "invitee")
          : null,
    });

    // Advance the status
    await tx
      .update(referralRelationships)
      .set({
        status: "rewarded",
        ruleSnapshot: frozenRule as Record<string, unknown>,
      })
      .where(eq(referralRelationships.inviteeUserId, userId));

    // Pay off existing debt
    await repayReferralDebts(tx, userId);
    if (frozenRule.inviterCredits > 0) {
      await repayReferralDebts(tx, rel.inviterUserId);
    }
  };
}
