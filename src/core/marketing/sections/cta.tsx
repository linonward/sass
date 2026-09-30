import { useFormatter, useTranslations } from "next-intl";

import type { LandingConfig, Plan } from "@/core/config/schema";
import { buttonVariants } from "@/core/ui/button";
import { bands, type Band } from "./band";
import { CtaLink, ctaTargets } from "./cta-buttons";
import { formatPrice } from "./price";
import { Section } from "./section";

export function Cta({
  waveFrom,
  plan,
  currency,
  showcaseUrl,
  demo,
  sections,
}: {
  waveFrom?: Band;
  plan?: Plan;
  currency: string;
  showcaseUrl?: string;
  demo: boolean;
  sections: LandingConfig["sections"];
}) {
  const t = useTranslations("Landing.cta");
  const format = useFormatter();
  const price = plan ? formatPrice(format, plan.price, currency) : undefined;
  const { primary, secondary } = ctaTargets({
    price,
    showcaseUrl,
    demo,
    sections,
    labels: {
      buy: t("buyCta", { price: price ?? "" }),
      demo: t("demoCta"),
      delivery: t("deliveryCta"),
      start: t("startCta"),
      pricing: t("pricingCta"),
      showcase: t("showcaseCta"),
    },
  });
  return (
    <Section id="cta" band={bands.cta} waveFrom={waveFrom}>
      <div className="mx-auto max-w-3xl text-center">
        <h2 className="landing-section-title whitespace-pre-line">
          {t("title")}
        </h2>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-6">
          <CtaLink
            target={primary}
            className={buttonVariants({ size: "marketing", tone: "primary" })}
          />
          <CtaLink
            target={secondary}
            className="text-primary-text inline-flex min-h-11 items-center gap-2 text-sm font-medium"
            iconClassName="size-4"
          />
        </div>
      </div>
    </Section>
  );
}
