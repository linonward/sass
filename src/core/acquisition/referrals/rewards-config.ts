import type { SiteConfig } from "@/core/config/schema";

export type RewardRule = {
  inviterCredits: number;
  inviteeCredits: number;
  allowedPlans?: string[];
  minPaymentByCurrency?: Record<string, number>;
  dailyCapPerInviter?: number;
  monthlyCapPerInviter?: number;
};

/** 奖励是否有效（至少一方有积分且正数）。 */
export function isRewardActive(rule: RewardRule): boolean {
  return rule.inviterCredits > 0 || rule.inviteeCredits > 0;
}

/** 从 site config 读取当前奖励规则。 */
export function getRewardRule(config: {
  acquisition: SiteConfig["acquisition"];
}): RewardRule {
  return config.acquisition.referrals.rewards;
}

/**
 * 校验订单是否符合发放条件。
 * - 计划在 allowedPlans 内（未配置 = 全部允许）
 * - 支付金额 >= minPaymentByCurrency（按币种匹配）
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
