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
import { cn } from "@/core/lib/utils";

import { bands, type Band } from "./band";
import { Section, SectionHeading } from "./section";

const icons: Record<LandingConfig["features"][number]["icon"], LucideIcon> = {
  zap: ZapIcon,
  shield: ShieldCheckIcon,
  globe: GlobeIcon,
  sparkles: SparklesIcon,
  creditCard: CreditCardIcon,
  chart: ChartColumnIcon,
};

/**
 * 三列网格上交替让某张卡横跨两列。
 *
 * 六个「同样阴影、同样 padding」的卡片本身就是模板味，这里用跨度错落的 bento
 * 节奏打散，宽卡里再放一行等宽的「证据行」（真实代码片段或真实标识符），
 * 让每张卡看起来像产品截图的一角而不是一个通用图标 + 两行字。
 * 配置里增删 feature 时按位置取模，布局照常成立。
 */
const spans = [
  "lg:col-span-2",
  "lg:col-span-1",
  "lg:col-span-1",
  "lg:col-span-2",
  "lg:col-span-1",
  "lg:col-span-2",
] as const;

export function Features({
  items,
  waveFrom,
}: {
  items: LandingConfig["features"];
  waveFrom?: Band;
}) {
  const t = useTranslations("Landing.features");
  // key 来自配置，由 messages 测试保证存在。
  const item = (key: string, field: "title" | "description" | "detail") =>
    t(`items.${key}.${field}` as "items.auth.title");

  return (
    <Section id="features" band={bands.features} waveFrom={waveFrom}>
      <SectionHeading title={t("title")} subtitle={t("subtitle")} />
      <ul className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map(({ key, icon }, index) => {
          const Icon = icons[icon];
          const wide = spans[index % spans.length] === "lg:col-span-2";
          return (
            <li
              key={key}
              className={cn(
                "bg-card sticker flex flex-col rounded-xl p-6",
                spans[index % spans.length],
              )}
            >
              <span className="bg-primary-band text-primary-text sticker flex size-10 shrink-0 items-center justify-center rounded-lg">
                <Icon className="size-5" aria-hidden />
              </span>
              <h3 className="heading-display mt-5 text-lg">
                {item(key, "title")}
              </h3>
              <p className="text-muted-foreground mt-2 text-sm text-pretty">
                {item(key, "description")}
              </p>
              {/* 证据行只在宽卡里出现，窄卡留白，密度才有节奏。
                  用换行而不是省略号截断：代码片段被尾部截掉就看不出是什么了。 */}
              {wide && (
                <p className="bg-muted text-muted-foreground mt-5 rounded-lg px-3 py-2 font-mono text-xs break-words">
                  {item(key, "detail")}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
