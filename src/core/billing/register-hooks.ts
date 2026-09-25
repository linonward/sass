import { creditsEnabled, grantCredits } from "@/core/credits";
import { sendEmail } from "@/core/email/send";
import { trackServer } from "@/core/observability/track-server";

import { createBillingEmailHandler } from "./emails";
import { createGrantCreditsHandler } from "./grant-credits";
import { registerOnBillingEvent } from "./on-billing-event";
import { createPurchaseTrackingHandler } from "./track-purchase";

// 套件自带的 onBillingEvent 钩子：套餐配置了 credits 且 features.credits 开启时发放积分。
registerOnBillingEvent(
  "billing:grant-credits",
  createGrantCreditsHandler({ enabled: creditsEnabled, grantCredits }),
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
