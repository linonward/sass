import { ArrowRightIcon, ArrowUpRightIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Link } from "@/core/i18n/navigation";
import { buttonVariants } from "@/core/ui/button";
import { bands, type Band } from "./band";
import { Section } from "./section";

export function Cta({ waveFrom }: { waveFrom?: Band }) {
  const t = useTranslations("Landing.cta");
  return (
    <Section id="cta" band={bands.cta} waveFrom={waveFrom}>
      <div className="mx-auto max-w-3xl text-center">
        <h2 className="landing-section-title whitespace-pre-line">
          {t("title")}
        </h2>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-6">
          <Link
            href="/demo"
            className={buttonVariants({ size: "marketing", tone: "primary" })}
          >
            {t("button")}
            <ArrowUpRightIcon aria-hidden />
          </Link>
          <Link
            href="/#delivery"
            className="text-primary-text inline-flex min-h-11 items-center gap-2 text-sm font-medium"
          >
            {t("secondaryCta")}
            <ArrowRightIcon className="size-4" aria-hidden />
          </Link>
        </div>
      </div>
    </Section>
  );
}
