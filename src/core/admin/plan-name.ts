import type { getTranslations } from "next-intl/server";

type PricingT = Awaited<ReturnType<typeof getTranslations<"Landing.pricing">>>;

/** 套餐名称。套餐已从 site.config.ts 删除时显示原始 ID，没有套餐时显示 "—"。 */
export function planLabel(t: PricingT, planId: string | null) {
  if (!planId) return "—";
  const key = `plans.${planId}.name` as "plans.free.name";
  return t.has(key) ? t(key) : planId;
}
