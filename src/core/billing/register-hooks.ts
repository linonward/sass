import { creditsEnabled, grantCredits } from "@/core/credits";

import { createGrantCreditsHandler } from "./grant-credits";
import { registerOnBillingEvent } from "./on-billing-event";

// 套件自带的 onBillingEvent 钩子：套餐配置了 credits 且 features.credits 开启时发放积分。
registerOnBillingEvent(
  "billing:grant-credits",
  createGrantCreditsHandler({ enabled: creditsEnabled, grantCredits }),
);
