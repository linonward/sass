import { CheckIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { PlanButton } from "@/core/billing/ui/plan-button";
import type { Plan } from "@/core/config/schema";
import { cn } from "@/core/lib/utils";

import { bands, type Band } from "./band";
import { Section, SectionHeading } from "./section";

export function Pricing({
  plans,
  currency,
  owned = {},
  headingLevel = 2,
  waveFrom,
}: {
  plans: Plan[];
  currency: string;
  /** 当前用户已拥有的套餐（仅 /pricing 传入；落地页是静态页面，不区分用户）。 */
  owned?: Record<string, "subscribed" | "purchased">;
  /** /pricing 页面把区块标题作为页面的 h1。 */
  headingLevel?: 1 | 2;
  waveFrom?: Band;
}) {
  const t = useTranslations("Landing.pricing");
  const format = useFormatter();
  // id / key 来自配置，由 messages 测试保证存在。
  const plan = (id: string, field: "name" | "description") =>
    t(`plans.${id}.${field}` as "plans.free.name");
  const feature = (key: string) =>
    t(`features.${key}` as "features.credits100");

  return (
    <Section id="pricing" band={bands.pricing} waveFrom={waveFrom}>
      <SectionHeading
        title={t("title")}
        subtitle={t("subtitle")}
        level={headingLevel}
      />
      <ul
        className={cn(
          "mt-12 grid gap-6",
          plans.length > 1 && "md:grid-cols-2",
          plans.length > 2 && "lg:grid-cols-3",
        )}
      >
        {plans.map((p) => (
          <li
            key={p.id}
            data-plan={p.id}
            className={cn(
              "bg-card sticker flex flex-col rounded-xl p-6",
              // 高亮套餐靠更厚的唇边和品牌色描边区分，不用浮在卡片外的角标。
              p.highlighted &&
                "border-[var(--primary-edge)] [--tw-shadow:0_6px_0_0_var(--edge)] [--edge:var(--primary-edge)]",
            )}
          >
            {p.highlighted && (
              <span className="bg-primary-band text-primary-text sticker mb-4 inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-xs font-medium">
                {t("popular")}
              </span>
            )}
            <h3 className="heading-display text-xl">{plan(p.id, "name")}</h3>
            <p className="text-muted-foreground mt-1.5 text-sm text-pretty">
              {plan(p.id, "description")}
            </p>
            <p className="mt-6 flex items-baseline gap-1.5">
              <span
                data-numeric
                className="heading-display text-4xl leading-none"
              >
                {format.number(p.price, {
                  style: "currency",
                  currency,
                  maximumFractionDigits: Number.isInteger(p.price) ? 0 : 2,
                })}
              </span>
              <span className="text-muted-foreground text-sm">
                {t(`interval.${p.interval}`)}
              </span>
            </p>
            <ul className="mt-6 flex-1 space-y-3 text-sm">
              {p.features.map((key) => (
                <li key={key} className="flex gap-2">
                  <CheckIcon
                    className="text-primary-text mt-0.5 size-4 shrink-0"
                    aria-hidden
                  />
                  {feature(key)}
                </li>
              ))}
            </ul>
            <PlanButton
              planId={p.id}
              label={t("cta", { plan: plan(p.id, "name") })}
              free={p.price === 0}
              highlighted={p.highlighted}
              owned={owned[p.id]}
            />
          </li>
        ))}
      </ul>
    </Section>
  );
}
