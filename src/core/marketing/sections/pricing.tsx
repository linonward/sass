import { CheckIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import type { Plan } from "@/core/config/schema";
import { cn } from "@/core/lib/utils";
import { Button } from "@/core/ui/button";

import { Section, SectionHeading } from "./section";

export function Pricing({
  plans,
  currency,
}: {
  plans: Plan[];
  currency: string;
}) {
  const t = useTranslations("Landing.pricing");
  const format = useFormatter();
  // id / key 来自配置，由 messages 测试保证存在。
  const plan = (id: string, field: "name" | "description") =>
    t(`plans.${id}.${field}` as "plans.free.name");
  const feature = (key: string) =>
    t(`features.${key}` as "features.credits100");

  return (
    <Section id="pricing">
      <SectionHeading title={t("title")} subtitle={t("subtitle")} />
      <ul
        className={cn(
          "mx-auto grid max-w-5xl gap-6",
          plans.length > 1 && "md:grid-cols-2",
          plans.length > 2 && "lg:grid-cols-3",
        )}
      >
        {plans.map((p) => (
          <li
            key={p.id}
            data-plan={p.id}
            className={cn(
              "bg-card relative flex flex-col rounded-xl border p-6",
              p.highlighted && "border-primary ring-primary ring-1",
            )}
          >
            {p.highlighted && (
              <span className="bg-primary text-primary-foreground absolute -top-3 left-6 rounded-full px-2.5 py-0.5 text-xs font-medium">
                {t("popular")}
              </span>
            )}
            <h3 className="font-medium">{plan(p.id, "name")}</h3>
            <p className="text-muted-foreground mt-1 text-sm">
              {plan(p.id, "description")}
            </p>
            <p className="mt-6 flex items-baseline gap-1">
              <span className="text-4xl font-semibold tracking-tight">
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
                    className="text-primary mt-0.5 size-4 shrink-0"
                    aria-hidden
                  />
                  {feature(key)}
                </li>
              ))}
            </ul>
            {/* 仅展示；T304 接入结账。 */}
            <Button
              type="button"
              size="lg"
              variant={p.highlighted ? "default" : "outline"}
              className="mt-8 w-full"
            >
              {t("cta", { plan: plan(p.id, "name") })}
            </Button>
          </li>
        ))}
      </ul>
    </Section>
  );
}
