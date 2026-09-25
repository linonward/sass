import { useTranslations } from "next-intl";
import Image from "next/image";

import type { LandingConfig } from "@/core/config/schema";
import { cn } from "@/core/lib/utils";
import { Link } from "@/core/i18n/navigation";
import { buttonVariants } from "@/core/ui/button";

import { Section } from "./section";

export function Hero({ image }: LandingConfig["hero"]) {
  const t = useTranslations("Landing.hero");

  return (
    <Section id="hero" className="pt-16 sm:pt-24">
      <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
        <p className="text-muted-foreground rounded-full border px-3 py-1 text-xs font-medium">
          {t("badge")}
        </p>
        <h1 className="mt-6 text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
          {t("title")}
        </h1>
        <p className="text-muted-foreground mt-6 max-w-2xl text-lg text-pretty">
          {t("subtitle")}
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/#pricing" className={buttonVariants({ size: "lg" })}>
            {t("primaryCta")}
          </Link>
          <Link
            href="/#features"
            className={buttonVariants({ size: "lg", variant: "outline" })}
          >
            {t("secondaryCta")}
          </Link>
        </div>
      </div>
      {image && (
        <div className="bg-muted/40 mx-auto mt-16 max-w-5xl rounded-xl border p-2 shadow-sm">
          <HeroImage
            {...image}
            alt={t("imageAlt")}
            className={image.darkSrc ? "dark:hidden" : undefined}
          />
          {image.darkSrc && (
            <HeroImage
              {...image}
              src={image.darkSrc}
              alt={t("imageAlt")}
              className="hidden dark:block"
            />
          )}
        </div>
      )}
    </Section>
  );
}

function HeroImage({
  src,
  width,
  height,
  alt,
  className,
}: {
  src: string;
  width: number;
  height: number;
  alt: string;
  className?: string;
}) {
  return (
    <Image
      src={src}
      width={width}
      height={height}
      alt={alt}
      // 首屏大图，尽早加载并同步解码以优化 LCP。
      loading="eager"
      fetchPriority="high"
      decoding="sync"
      sizes="(min-width: 1024px) 1024px, 100vw"
      className={cn("h-auto w-full rounded-lg", className)}
    />
  );
}
