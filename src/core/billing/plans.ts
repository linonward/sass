import type { Plan } from "@/core/config/schema";

import siteConfig from "../../../site.config";

export function getPlan(planId: string): Plan | undefined {
  return siteConfig.billing.plans.find((plan) => plan.id === planId);
}

/**
 * 对外展示、可以新购的套餐（去掉 `hidden` 的）。定价页、首页、llms.txt 都用它；
 * 按 id 查套餐（续费发积分、后台统计）仍用 getPlan —— 隐藏的套餐对已有订阅照常有效。
 */
export function listedPlans(): Plan[] {
  return siteConfig.billing.plans.filter((plan) => !plan.hidden);
}

/** 服务商的产品 ID → 套餐。parseEvent 用它把 webhook 里的产品映射成 planId。 */
export function planByProductId(productId: string): Plan | undefined {
  return siteConfig.billing.plans.find(
    (plan) => plan.providerProductId === productId,
  );
}
