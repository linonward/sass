import { useTranslations } from "next-intl";

import type { LandingConfig } from "@/core/config/schema";
import { cn } from "@/core/lib/utils";
import { bands, type Band } from "./band";
import { CreditLedger, StudioPreview, UsagePreview } from "./product-preview";
import { Wave } from "./wave";

export function Features({
  items,
  waveFrom,
}: {
  items: LandingConfig["features"];
  waveFrom?: Band;
}) {
  const t = useTranslations("Landing.features");
  const item = (key: string, field: "title" | "description" | "detail") =>
    t(`items.${key}.${field}` as "items.auth.title");
  return (
    <section
      id="features"
      data-section="features"
      className="bg-background scroll-mt-[calc(var(--header-height)+1rem)]"
    >
      {waveFrom && waveFrom !== bands.features && <Wave from={waveFrom} />}
      <div className="container-marketing pt-16 pb-5 sm:pt-24">
        <h2 className="landing-section-title max-w-4xl">{t("title")}</h2>
        <p className="text-muted-foreground mt-4 text-lg">{t("subtitle")}</p>
      </div>
      <ul>
        {items.map(({ key, preview }, i) => (
          <li
            key={key}
            className={cn("py-12 sm:py-16", i % 2 === 1 && "bg-primary-band")}
          >
            <div className="container-marketing grid items-center gap-9 lg:grid-cols-2 lg:gap-20">
              <div className={cn("min-w-0", i % 2 === 1 && "lg:order-2")}>
                <p className="text-primary-text mb-5 font-mono text-sm font-semibold">
                  0{i + 1}
                </p>
                <h3 className="landing-section-title">{item(key, "title")}</h3>
                <p className="text-muted-foreground mt-5 max-w-[36ch] text-lg leading-relaxed">
                  {item(key, "description")}
                </p>
                <p className="text-muted-foreground mt-6 text-sm leading-relaxed">
                  {item(key, "detail")}
                </p>
              </div>
              <div className="min-w-0">
                {preview === "billing" ? (
                  <CreditLedger />
                ) : preview === "ai" ? (
                  <StudioPreview gallery />
                ) : preview === "usage" ? (
                  <UsagePreview />
                ) : (
                  <div className="landing-frame p-8 text-lg leading-relaxed">
                    {item(key, "detail")}
                  </div>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
