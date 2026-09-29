import { ArrowUpRightIcon, CheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Link } from "@/core/i18n/navigation";
import { bands, type Band } from "./band";
import { Section } from "./section";

export function Delivery({ waveFrom }: { waveFrom?: Band }) {
  const t = useTranslations("Landing.delivery");
  return (
    <Section id="delivery" band={bands.delivery} waveFrom={waveFrom}>
      <div className="grid gap-12 lg:grid-cols-2 lg:gap-20">
        <div>
          <h2 className="landing-section-title max-w-[14ch]">{t("title")}</h2>
          <p className="text-muted-foreground mt-5 max-w-[35ch] text-lg leading-relaxed">
            {t("description")}
          </p>
          <div className="bg-warning-band border-warning-edge mt-8 rounded-lg border p-6">
            <p className="text-sm font-medium">{t("offer")}</p>
            <p className="heading-display mt-4 text-4xl">{t("pending")}</p>
            <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
              {t("terms")}
            </p>
          </div>
          <Link
            href="/demo"
            className="text-primary-text mt-6 inline-flex min-h-11 items-center gap-2 border-b text-base font-semibold"
          >
            {t("demo")}
            <ArrowUpRightIcon className="size-4" aria-hidden />
          </Link>
        </div>
        <dl className="divide-border border-border divide-y border-t">
          {(["source", "brand", "docs", "examples"] as const).map((key) => (
            <div key={key} className="flex gap-5 py-7">
              <CheckIcon
                className="text-primary-text bg-primary-band mt-1 size-8 shrink-0 rounded-full p-1.5"
                aria-hidden
              />
              <div>
                <dt className="text-xl font-semibold">
                  {t(`items.${key}.title`)}
                </dt>
                <dd className="text-muted-foreground mt-2 leading-relaxed">
                  {t(`items.${key}.description`)}
                </dd>
              </div>
            </div>
          ))}
        </dl>
      </div>
    </Section>
  );
}
