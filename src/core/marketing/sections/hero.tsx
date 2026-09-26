import { ArrowRightIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import Image from "next/image";

import type { LandingConfig, Plan } from "@/core/config/schema";
import { Link } from "@/core/i18n/navigation";
import { cn } from "@/core/lib/utils";
import { buttonVariants } from "@/core/ui/button";

import { HeroCanvas } from "./hero-canvas";
import { bands, type Band } from "./band";
import { Section } from "./section";

export function Hero({
  image,
  plan,
  currency,
  waveFrom,
}: LandingConfig["hero"] & {
  plan?: Plan;
  currency: string;
  waveFrom?: Band;
}) {
  const t = useTranslations("Landing.hero");

  return (
    <Section id="hero" band={bands.hero} waveFrom={waveFrom}>
      {/* 两栏、文字在左。不用「居中 hero + 两个并排 CTA」那套默认版式。 */}
      <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <div className="min-w-0">
          <p className="bg-background sticker inline-flex items-center rounded-full px-3 py-1 text-xs font-medium">
            {t("badge")}
          </p>
          {/* h1 必须是单一文本节点：e2e 断言它的可访问名精确等于 hero.title。
              拆成多个 span 逐词上色会改变可访问名，所以这里不做。 */}
          <h1 className="heading-display mt-6 text-[clamp(2.25rem,7vw,4.25rem)]">
            {t("title")}
          </h1>
          <p className="text-muted-foreground mt-6 max-w-[46ch] text-lg text-pretty">
            {t("subtitle")}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/#pricing"
              className={buttonVariants({ size: "marketing", tone: "primary" })}
            >
              {t("primaryCta")}
            </Link>
            <Link
              href="/#features"
              className={cn(
                buttonVariants({
                  size: "marketing",
                  variant: "outline",
                  tone: "primary",
                }),
                // 次要按钮在品牌色带上要自己撑出实底，否则和带子融在一起。
                "bg-background hover:bg-background/90",
              )}
            >
              {t("secondaryCta")}
              <ArrowRightIcon aria-hidden />
            </Link>
          </div>
        </div>

        <div className="min-w-0">
          {/* 配了图片就优先用图片，没配则渲染拼贴出来的产品 mock。
              拼贴用的是配置里真实的高亮套餐，不是假数据。 */}
          {image ? (
            <HeroImage {...image} alt={t("imageAlt")} />
          ) : (
            <HeroCanvas plan={plan} currency={currency} />
          )}
        </div>
      </div>
    </Section>
  );
}

function HeroImage({
  src,
  darkSrc,
  width,
  height,
  alt,
}: {
  src: string;
  darkSrc?: string;
  width: number;
  height: number;
  alt: string;
}) {
  const sizes = "(min-width: 1024px) 640px, 100vw";
  return (
    <div className="sticker-lg overflow-hidden rounded-xl">
      <Image
        src={src}
        width={width}
        height={height}
        alt={alt}
        // 首屏大图，尽早加载并同步解码以优化 LCP。
        loading="eager"
        fetchPriority="high"
        decoding="sync"
        sizes={sizes}
        className={cn("h-auto w-full", darkSrc && "dark:hidden")}
      />
      {darkSrc && (
        <Image
          src={darkSrc}
          width={width}
          height={height}
          alt={alt}
          loading="eager"
          fetchPriority="high"
          decoding="sync"
          sizes={sizes}
          className="hidden h-auto w-full dark:block"
        />
      )}
    </div>
  );
}
