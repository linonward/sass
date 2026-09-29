import type { Plan } from "@/core/config/schema";

import siteConfig from "../../../site.config";

export function getPlan(planId: string): Plan | undefined {
  return siteConfig.billing.plans.find((plan) => plan.id === planId);
}

/**
 * Plans that are shown publicly and can be bought (those without `hidden`). Used by the pricing page,
 * the home page and llms.txt. Looking a plan up by id (granting credits on renewal, admin stats) still
 * uses getPlan — a hidden plan keeps working for existing subscriptions.
 */
export function listedPlans(): Plan[] {
  return siteConfig.billing.plans.filter((plan) => !plan.hidden);
}

/** Provider product ID → plan. parseEvent uses it to map the product in a webhook to a planId. */
export function planByProductId(productId: string): Plan | undefined {
  return siteConfig.billing.plans.find(
    (plan) => plan.providerProductId === productId,
  );
}
