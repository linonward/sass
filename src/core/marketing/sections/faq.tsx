import { ChevronDownIcon, CircleHelpIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { bands, type Band } from "./band";
import { Section } from "./section";

export function Faq({ items, waveFrom }: { items: string[]; waveFrom?: Band }) {
  const t = useTranslations("Landing.faq");
  const item = (key: string, field: "question" | "answer") =>
    t(`items.${key}.${field}` as "items.photos.question");
  return (
    <Section id="faq" band={bands.faq} waveFrom={waveFrom} className="border-t">
      <div className="grid gap-10 lg:grid-cols-[0.75fr_1.25fr] lg:gap-20">
        <h2 className="landing-section-title max-w-[12ch]">{t("title")}</h2>
        <div>
          {items.map((key, index) => (
            <details
              key={key}
              open={index === 0}
              className="group open:bg-primary-band/40 border-b open:mb-3 open:rounded-lg open:border"
            >
              <summary className="focus-visible:outline-ring flex min-h-16 cursor-pointer list-none items-center gap-4 px-4 py-5 text-base font-medium focus-visible:outline-2 sm:text-lg [&::-webkit-details-marker]:hidden">
                <CircleHelpIcon
                  className="text-primary-text size-5 shrink-0"
                  aria-hidden
                />
                <span>{item(key, "question")}</span>
                <ChevronDownIcon
                  className="text-muted-foreground ml-auto size-5 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none"
                  aria-hidden
                />
              </summary>
              <p className="text-muted-foreground px-4 pb-6 pl-13 text-sm leading-relaxed">
                {item(key, "answer")}
              </p>
            </details>
          ))}
        </div>
      </div>
    </Section>
  );
}
