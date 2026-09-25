import { ChevronDownIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Section, SectionHeading } from "./section";

// 用原生 <details> 实现折叠，不需要客户端 JS。
export function Faq({ items }: { items: string[] }) {
  const t = useTranslations("Landing.faq");
  // key 来自配置，由 messages 测试保证存在。
  const item = (key: string, field: "question" | "answer") =>
    t(`items.${key}.${field}` as "items.stack.question");

  return (
    <Section id="faq" className="bg-muted/40">
      <SectionHeading title={t("title")} />
      <div className="bg-card mx-auto max-w-3xl divide-y rounded-xl border">
        {items.map((key) => (
          <details key={key} className="group px-6 py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
              {item(key, "question")}
              <ChevronDownIcon
                className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180"
                aria-hidden
              />
            </summary>
            <p className="text-muted-foreground mt-3 text-sm">
              {item(key, "answer")}
            </p>
          </details>
        ))}
      </div>
    </Section>
  );
}
