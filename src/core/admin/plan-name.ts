import type { getTranslations } from "next-intl/server";

type PricingT = Awaited<ReturnType<typeof getTranslations<"Landing.pricing">>>;

/**
 * Plan name. Shows the raw ID if the plan was removed from site.config.ts, and "—" when there's no
 * plan.
 */
export function planLabel(t: PricingT, planId: string | null) {
  if (!planId) return "—";
  const key = `plans.${planId}.name` as "plans.free.name";
  return t.has(key) ? t(key) : planId;
}
