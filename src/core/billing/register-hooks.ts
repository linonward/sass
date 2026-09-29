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

// The kit's built-in onBillingEvent hook: grants credits when the plan configures credits and
// features.credits is on.
registerOnBillingEvent(
  "billing:grant-credits",
  createGrantCreditsHandler({ enabled: creditsEnabled, grantCredits }),
);

// Refunds reclaim credits in proportion to the unrefunded share (also gated by features.credits).
registerOnBillingEvent(
  "billing:reclaim-credits",
  createReclaimCreditsHandler({ enabled: creditsEnabled, reclaimCredits }),
);

// Referral reward grant: on checkout.completed / subscription.renewed, grant both sides their reward.
registerOnBillingEvent(
  "referrals:grant-reward",
  createReferralGrantHandler({
    enabled: referralsEnabled,
    grantCredits,
    config: siteConfig,
  }),
);

// Referral reward reclaim: on refund.created, reclaim both sides' rewards.
registerOnBillingEvent(
  "referrals:reclaim-reward",
  createReferralReclaimHandler({
    enabled: referralsEnabled,
    reclaimCredits,
    rewardsEnabled: referralRewardsEnabled,
  }),
);

// Notification emails for payment succeeded, payment failed and subscription canceled; sent after
// the transaction commits.
registerOnBillingEvent(
  "billing:emails",
  createBillingEmailHandler({ send: sendEmail, creditsEnabled }),
);

// Conversion event for successful payments (when observability.analytics is on); sent after commit
// and after the response.
registerOnBillingEvent(
  "billing:track-purchase",
  createPurchaseTrackingHandler({ track: trackServer }),
);
