import { creditsEnabled, grantCredits, reclaimCredits } from "@/core/credits";
import { sendEmail } from "@/core/email/send";
import { trackServer } from "@/core/observability/track-server";

import { createBillingEmailHandler } from "./emails";
import { createGrantCreditsHandler } from "./grant-credits";
import { registerOnBillingEvent } from "./on-billing-event";
import { createPurchaseTrackingHandler } from "./track-purchase";
import { createReclaimCreditsHandler } from "./reclaim-credits";
import { createReferralGrantHandler } from "./referral-grant";
import { createReferralReclaimHandler } from "./referral-reclaim";
import siteConfig from "../../../site.config";
import {
  isRewardActive,
  getRewardRule,
} from "../acquisition/referrals/rewards-config";

const referralsEnabled =
  siteConfig.acquisition.referrals.enabled && creditsEnabled;
const referralRewardsEnabled =
  referralsEnabled && isRewardActive(getRewardRule(siteConfig));

// 套件自带的 onBillingEvent 钩子：套餐配置了 credits 且 features.credits 开启时发放积分。
registerOnBillingEvent(
  "billing:grant-credits",
  createGrantCreditsHandler({ enabled: creditsEnabled, grantCredits }),
);

// 退款按未退比例回收集分（同样受 features.credits 控制）。
registerOnBillingEvent(
  "billing:reclaim-credits",
  createReclaimCreditsHandler({ enabled: creditsEnabled, reclaimCredits }),
);

// 邀请奖励发放：checkout.completed / subscription.renewed 时发放双方奖励。
registerOnBillingEvent(
  "referrals:grant-reward",
  createReferralGrantHandler({
    enabled: referralsEnabled,
    grantCredits,
    config: siteConfig,
  }),
);

// 邀请奖励回收：refund.created 时回收双方奖励。
registerOnBillingEvent(
  "referrals:reclaim-reward",
  createReferralReclaimHandler({
    enabled: referralsEnabled,
    reclaimCredits,
    rewardsEnabled: referralRewardsEnabled,
  }),
);

// 付款成功、付款失败、订阅取消的通知邮件；在事务提交后发送。
registerOnBillingEvent(
  "billing:emails",
  createBillingEmailHandler({ send: sendEmail, creditsEnabled }),
);

// 付款成功的转化事件（observability.analytics 开启时）；在事务提交、响应返回之后发送。
registerOnBillingEvent(
  "billing:track-purchase",
  createPurchaseTrackingHandler({ track: trackServer }),
);
