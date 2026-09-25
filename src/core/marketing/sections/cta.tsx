import { useTranslations } from "next-intl";

import { Link } from "@/core/i18n/navigation";
import { buttonVariants } from "@/core/ui/button";

import { Section } from "./section";

export function Cta() {
  const t = useTranslations("Landing.cta");

  return (
    <Section id="cta">
      <div className="bg-primary text-primary-foreground flex flex-col items-center rounded-2xl px-6 py-16 text-center">
        <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {t("title")}
        </h2>
        <p className="mt-4 max-w-xl text-lg text-pretty opacity-90">
          {t("subtitle")}
        </p>
        <Link
          href="/#pricing"
          className={buttonVariants({
            size: "lg",
            variant: "secondary",
            className: "mt-8",
          })}
        >
          {t("button")}
        </Link>
      </div>
    </Section>
  );
}
