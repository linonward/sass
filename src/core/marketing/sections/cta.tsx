import { ArrowRightIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Link } from "@/core/i18n/navigation";
import { buttonVariants } from "@/core/ui/button";

import { bands, type Band } from "./band";
import { Section } from "./section";

export function Cta({ waveFrom }: { waveFrom?: Band }) {
  const t = useTranslations("Landing.cta");

  return (
    <Section id="cta" band={bands.cta} waveFrom={waveFrom}>
      {/* 左对齐而不是居中：整页的标题都是左起的，收尾突然居中会断掉阅读轴。 */}
      <div className="max-w-2xl">
        <h2 className="heading-display text-4xl sm:text-5xl">{t("title")}</h2>
        <p className="text-muted-foreground mt-5 text-lg text-pretty">
          {t("subtitle")}
        </p>
        <Link
          href="/#pricing"
          className={`${buttonVariants({ size: "marketing", tone: "primary" })} mt-8`}
        >
          {t("button")}
          <ArrowRightIcon aria-hidden />
        </Link>
      </div>
    </Section>
  );
}
