import {
  ChartColumnIcon,
  CreditCardIcon,
  GlobeIcon,
  ShieldCheckIcon,
  SparklesIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";

import type { LandingConfig } from "@/core/config/schema";

import { Section, SectionHeading } from "./section";

const icons: Record<LandingConfig["features"][number]["icon"], LucideIcon> = {
  zap: ZapIcon,
  shield: ShieldCheckIcon,
  globe: GlobeIcon,
  sparkles: SparklesIcon,
  creditCard: CreditCardIcon,
  chart: ChartColumnIcon,
};

export function Features({ items }: { items: LandingConfig["features"] }) {
  const t = useTranslations("Landing.features");
  // key 来自配置，由 messages 测试保证存在。
  const item = (key: string, field: "title" | "description") =>
    t(`items.${key}.${field}` as "items.auth.title");

  return (
    <Section id="features" className="bg-muted/40">
      <SectionHeading title={t("title")} subtitle={t("subtitle")} />
      <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {items.map(({ key, icon }) => {
          const Icon = icons[icon];
          return (
            <li key={key} className="bg-card rounded-xl border p-6">
              <span className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-lg">
                <Icon className="size-5" aria-hidden />
              </span>
              <h3 className="mt-4 font-medium">{item(key, "title")}</h3>
              <p className="text-muted-foreground mt-2 text-sm">
                {item(key, "description")}
              </p>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
