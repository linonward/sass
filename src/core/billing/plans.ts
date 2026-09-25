import type { Plan } from "@/core/config/schema";

import siteConfig from "../../../site.config";

export function getPlan(planId: string): Plan | undefined {
  return siteConfig.billing.plans.find((plan) => plan.id === planId);
}

/** 服务商的产品 ID → 套餐。parseEvent 用它把 webhook 里的产品映射成 planId。 */
export function planByProductId(productId: string): Plan | undefined {
  return siteConfig.billing.plans.find(
    (plan) => plan.providerProductId === productId,
  );
}
