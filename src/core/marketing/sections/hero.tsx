import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  DatabaseIcon,
  NotebookTextIcon,
  WalletCardsIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import Image from "next/image";

import type { LandingConfig } from "@/core/config/schema";
import { Link } from "@/core/i18n/navigation";
import { cn } from "@/core/lib/utils";
import { buttonVariants } from "@/core/ui/button";
import { bands, type Band } from "./band";
import { Section } from "./section";
import { StudioPreview } from "./product-preview";
import { ColorSwitcher } from "./color-switcher";
import { Wave } from "./wave";

export function Hero({
  image,
  waveFrom,
  primaryColor,
}: LandingConfig["hero"] & { waveFrom?: Band; primaryColor: string }) {
  const t = useTranslations("Landing.hero");
  const title = t("title");
  const accent = t("titleAccent");
  const accentAt = title.lastIndexOf(accent);
  const clauseAt = title.indexOf("，") + 1;
  return (
    <div>
      <Section
        id="hero"
        band={bands.hero}
        waveFrom={waveFrom}
        className="landing-hero"
      >
        <div className="grid items-center gap-12 lg:grid-cols-[0.95fr_1.05fr] lg:gap-14">
          <div className="min-w-0">
            <h1 className="landing-headline" aria-label={title}>
              {accentAt >= 0 ? (
                <>
                  {clauseAt > 0 ? (
                    <>
                      <span className="block">{title.slice(0, clauseAt)}</span>
                      {title.slice(clauseAt, accentAt)}
                    </>
                  ) : (
                    title.slice(0, accentAt)
                  )}
                  <span className="text-primary-text">
                    {title.slice(accentAt)}
                  </span>
                </>
              ) : (
                title
              )}
            </h1>
            <p className="text-muted-foreground mt-7 max-w-[34ch] text-lg leading-relaxed whitespace-pre-line sm:text-xl">
              {t("subtitle")}
            </p>
            <div className="mt-9 flex flex-wrap gap-4">
              <Link
                href="/demo"
                className={cn(
                  buttonVariants({ size: "marketing", tone: "primary" }),
                  "landing-button",
                )}
              >
                {t("primaryCta")}
                <ArrowUpRightIcon aria-hidden />
              </Link>
              <Link
                href="/#delivery"
                className={cn(
                  buttonVariants({
                    size: "marketing",
                    variant: "outline",
                    tone: "primary",
                  }),
                  "landing-button bg-background",
                )}
              >
                {t("secondaryCta")}
                <ArrowRightIcon aria-hidden />
              </Link>
            </div>
            <ColorSwitcher
              current={primaryColor}
              label={t("colorSwitcher.label")}
              prompt={t("colorSwitcher.prompt")}
              switchToLabel={t("colorSwitcher.switchTo")}
            />
            <p className="text-muted-foreground mt-8 text-xs leading-relaxed sm:text-sm">
              {t("stack")}
            </p>
          </div>
          <div className="min-w-0">
            {image ? (
              <div className="landing-frame overflow-hidden">
                <Image
                  src={image.src}
                  alt={t("imageAlt")}
                  width={image.width}
                  height={image.height}
                  sizes="(min-width: 1024px) 640px, 100vw"
                  loading="eager"
                  fetchPriority="high"
                  className={cn(
                    "h-auto w-full",
                    image.darkSrc && "dark:hidden",
                  )}
                />
                {image.darkSrc && (
                  <Image
                    src={image.darkSrc}
                    alt={t("imageAlt")}
                    width={image.width}
                    height={image.height}
                    sizes="(min-width: 1024px) 640px, 100vw"
                    className="hidden h-auto w-full dark:block"
                  />
                )}
              </div>
            ) : (
              <StudioPreview />
            )}
          </div>
        </div>
      </Section>
      <div className="bg-primary-band">
        <Wave from="canvas" className="h-6 sm:h-9" />
        <div className="container-marketing grid gap-6 py-6 sm:grid-cols-3 sm:gap-8">
          {([WalletCardsIcon, DatabaseIcon, NotebookTextIcon] as const).map(
            (Icon, i) => (
              <div key={i} className="flex items-center gap-4">
                <span className="text-primary-text bg-background/50 flex size-12 shrink-0 items-center justify-center rounded-full">
                  <Icon className="size-6" aria-hidden />
                </span>
                <div>
                  <p className="text-base font-semibold">
                    <span className="text-primary-text mr-2 font-mono text-sm">
                      0{i + 1}
                    </span>
                    {t(`steps.step${i + 1}` as "steps.step1")}
                  </p>
                  <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                    {t(`steps.detail${i + 1}` as "steps.detail1")}
                  </p>
                </div>
                {i < 2 && (
                  <ArrowRightIcon
                    className="text-muted-foreground ml-auto hidden size-5 lg:block"
                    aria-hidden
                  />
                )}
              </div>
            ),
          )}
        </div>
        <Wave from="primary" className="bg-background h-6 sm:h-9" />
      </div>
    </div>
  );
}
