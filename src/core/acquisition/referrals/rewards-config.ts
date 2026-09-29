import type { SiteConfig } from "@/core/config/schema";

export type RewardRule = {
  inviterCredits: number;
  inviteeCredits: number;
  allowedPlans?: string[];
  minPaymentByCurrency?: Record<string, number>;
  dailyCapPerInviter?: number;
  monthlyCapPerInviter?: number;
};

/** Whether the reward is active (at least one side gets a positive number of credits). */
export function isRewardActive(rule: RewardRule): boolean {
  return rule.inviterCredits > 0 || rule.inviteeCredits > 0;
}

/** Reads the current reward rule from the site config. */
export function getRewardRule(config: {
  acquisition: SiteConfig["acquisition"];
}): RewardRule {
  return config.acquisition.referrals.rewards;
}

/**
 * Checks whether an order qualifies for a grant.
 * - The plan is in allowedPlans (not configured = all allowed)
 * - The amount paid >= minPaymentByCurrency (matched by currency)
 */
export function isOrderEligible(
  rule: RewardRule,
  planId: string,
  amount: number,
  currency: string,
): boolean {
  if (rule.allowedPlans && rule.allowedPlans.length > 0) {
    if (!rule.allowedPlans.includes(planId)) return false;
  }
  const min =
    rule.minPaymentByCurrency?.[currency] ?? rule.minPaymentByCurrency?.["*"];
  if (min != null && amount < min) return false;
  return true;
}
