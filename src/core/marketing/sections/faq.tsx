import { ChevronDownIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { bands, type Band } from "./band";
import { Section, SectionHeading } from "./section";

// 用原生 <details> 实现折叠，不需要客户端 JS。
export function Faq({ items, waveFrom }: { items: string[]; waveFrom?: Band }) {
  const t = useTranslations("Landing.faq");
  // key 来自配置，由 messages 测试保证存在。
  const item = (key: string, field: "question" | "answer") =>
    t(`items.${key}.${field}` as "items.stack.question");

  return (
    <Section id="faq" band={bands.faq} waveFrom={waveFrom}>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-16">
        <SectionHeading title={t("title")} />
        {/* 每条问答是一张独立贴纸卡，不再是连成一体的分割线列表。 */}
        <div className="space-y-3">
          {items.map((key) => (
            <details
              key={key}
              className="bg-card sticker group rounded-xl px-5 py-4"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
                {item(key, "question")}
                <ChevronDownIcon
                  className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <p className="text-muted-foreground mt-3 text-sm text-pretty">
                {item(key, "answer")}
              </p>
            </details>
          ))}
        </div>
      </div>
    </Section>
  );
}
