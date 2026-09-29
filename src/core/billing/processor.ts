import { env } from "@/core/env";

import siteConfig from "../../../site.config";
import type { BillingProviderName } from "./env";

export type PaymentProcessor = {
  /** 对外展示的名字（法律页、收据说明里用）。 */
  name: string;
  /** 是否是 Merchant of Record：法律上的卖方，代收税费、处理退款与拒付。 */
  merchantOfRecord: boolean;
};

/** 各服务商的对外名称与角色。Stripe 标准模式不是 MoR（见 docs/billing.md）。 */
export const paymentProcessors: Record<BillingProviderName, PaymentProcessor> =
  {
    creem: { name: "Creem", merchantOfRecord: true },
    stripe: { name: "Stripe", merchantOfRecord: false },
    lemonsqueezy: { name: "Lemon Squeezy", merchantOfRecord: true },
    waffo: { name: "Waffo Pancake", merchantOfRecord: true },
  };

/**
 * 当前生效的服务商（`BILLING_PROVIDER` 优先，fake 不算，退回 site.config 的 billing.provider）。
 * 法律页按它写名称，线上用环境变量换服务商时法律页跟着变，不用改正文。
 */
export function activePaymentProcessor(): PaymentProcessor {
  const provider =
    env.BILLING_PROVIDER === "fake"
      ? siteConfig.billing.provider
      : env.BILLING_PROVIDER;
  return paymentProcessors[provider];
}
