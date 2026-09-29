import Image from "next/image";
import { ArrowUpRightIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import type { LandingConfig } from "@/core/config/schema";

import { bands, type Band } from "./band";
import { Section } from "./section";

type Item = LandingConfig["testimonials"]["items"][number];

/** Native video controls keep the wall server-rendered and load media only on demand. */
export function Testimonials({
  items,
  waveFrom,
}: {
  items: Item[];
  waveFrom?: Band;
}) {
  const t = useTranslations("Landing.testimonials");
  if (items.length === 0) return null;

  return (
    <Section id="testimonials" band={bands.testimonials} waveFrom={waveFrom}>
      <div className="mx-auto mb-10 max-w-2xl text-center sm:mb-14">
        <p className="text-primary-text text-sm font-semibold">
          {t("eyebrow")}
        </p>
        <h2 className="landing-section-title mt-4">{t("title")}</h2>
        <p className="text-muted-foreground mt-5 text-lg text-pretty">
          {t("subtitle")}
        </p>
        {items.some((item) => item.example) && (
          <p className="text-muted-foreground mt-5 text-sm">
            {t("exampleNotice")}
          </p>
        )}
      </div>
      {/* Column flow preserves DOM/keyboard reading order: down each column, then across. */}
      <div className="columns-1 gap-6 sm:columns-2 lg:columns-3">
        {items.map((item) => (
          <article
            key={item.key}
            data-testimonial={item.key}
            className="sticker-lg bg-card mb-6 inline-block w-full min-w-0 break-inside-avoid overflow-hidden rounded-2xl text-left align-top [overflow-wrap:anywhere]"
          >
            {item.type === "image" && (
              <Image
                {...item.media}
                alt={t(`items.${item.key}.imageAlt`)}
                sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                className="border-border aspect-[16/10] w-full border-b object-cover"
              />
            )}
            {item.type === "video" && (
              <video
                src={item.media.src}
                poster={item.media.poster}
                width={item.media.width}
                height={item.media.height}
                aria-label={t("videoLabel", { name: item.author.name })}
                className="bg-background border-border h-auto w-full border-b"
                controls
                playsInline
                preload="none"
              >
                {item.media.captions.map((track, index) => (
                  <track
                    key={track.srcLang}
                    kind="captions"
                    {...track}
                    default={index === 0}
                  />
                ))}
                <a href={item.media.src}>{t("videoFallback")}</a>
              </video>
            )}
            <div className="p-6 sm:p-7">
              {item.example && (
                <p className="text-muted-foreground mb-3 text-xs">
                  {t("exampleLabel")}
                </p>
              )}
              <blockquote className="text-lg leading-relaxed">
                {t.rich(`items.${item.key}.quote`, {
                  highlight: (chunks) => (
                    <mark className="bg-primary-band text-foreground box-decoration-clone px-0.5">
                      {chunks}
                    </mark>
                  ),
                })}
              </blockquote>
              <div className="border-border mt-6 flex items-center gap-3 border-t pt-5">
                {item.author.avatar ? (
                  <Image
                    src={item.author.avatar}
                    alt=""
                    width={40}
                    height={40}
                    className="size-10 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span
                    aria-hidden
                    className="bg-primary-band text-primary-text flex size-10 shrink-0 items-center justify-center rounded-full font-semibold"
                  >
                    {Array.from(item.author.name)[0]}
                  </span>
                )}
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{item.author.name}</p>
                  <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                    {t(`items.${item.key}.role`)}
                  </p>
                </div>
              </div>
              {item.sourceUrl && (
                <a
                  href={item.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary-text mt-4 inline-flex min-h-11 items-center gap-1 text-sm underline underline-offset-4"
                >
                  {t("source")}
                  <ArrowUpRightIcon className="size-4" aria-hidden />
                </a>
              )}
            </div>
          </article>
        ))}
      </div>
    </Section>
  );
}
