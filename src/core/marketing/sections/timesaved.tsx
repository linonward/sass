import { ArrowRightIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import type { LandingConfig } from "@/core/config/schema";
import { bands, type Band } from "./band";
import { Section } from "./section";

/**
 * "Time saved": work the template has already done, listed item by item with estimated hours and a
 * total on the last row. It translates features into time the buyer saves; the hours are estimates
 * set in site.config.ts.
 */
export function TimeSaved({
  items,
  waveFrom,
}: {
  items: LandingConfig["timeSaved"];
  waveFrom?: Band;
}) {
  const t = useTranslations("Landing.timesaved");
  const item = (key: string, field: "title" | "detail") =>
    t(`items.${key}.${field}` as "items.payments.title");
  const total = items.reduce((sum, { hours }) => sum + hours, 0);
  return (
    <Section id="timesaved" band={bands.timesaved} waveFrom={waveFrom}>
      <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20">
        <div className="lg:sticky lg:top-[calc(var(--header-height)+2rem)] lg:self-start">
          <h2 className="landing-section-title whitespace-pre-line">
            {t("title")}
          </h2>
          <p className="text-muted-foreground mt-5 max-w-[35ch] text-lg leading-relaxed">
            {t("subtitle")}
          </p>
        </div>
        <div className="bg-card sticker-lg rounded-xl p-5 sm:p-7">
          <ul className="divide-border divide-y">
            {items.map(({ key, hours }) => (
              <li key={key} className="flex items-start gap-4 py-4">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{item(key, "title")}</p>
                  <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                    {item(key, "detail")}
                  </p>
                </div>
                <span
                  data-numeric
                  className="text-muted-foreground shrink-0 text-sm font-medium whitespace-nowrap tabular-nums"
                >
                  {t("hours", { hours })}
                </span>
              </li>
            ))}
          </ul>
          <div
            className="border-foreground mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-t-2 pt-5"
            data-testid="timesaved-total"
          >
            <p className="font-semibold">
              {t("total")}
              <span
                data-numeric
                className="heading-display ml-3 text-3xl leading-none"
              >
                {t("hours", { hours: total })}
              </span>
            </p>
            <p className="text-primary-text inline-flex items-center gap-2 text-lg font-semibold">
              <ArrowRightIcon className="size-5" aria-hidden />
              {t("result")}
            </p>
          </div>
        </div>
      </div>
    </Section>
  );
}
