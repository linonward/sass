"use client";

import { useId, useState } from "react";
import { ArrowDownIcon, CheckIcon } from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";

import { cn } from "@/core/lib/utils";

export function CreditLedger({ compact = false }: { compact?: boolean }) {
  const t = useTranslations("LandingPreview");
  return (
    <div
      className={cn(
        "landing-frame p-5 sm:p-6",
        compact && "landing-credit-receipt",
      )}
    >
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">
          {t(compact ? "ledger" : "paymentTitle")}
        </p>
        {!compact && (
          <span className="text-muted-foreground text-xs">{t("sample")}</span>
        )}
      </div>
      {!compact && (
        <>
          <div className="bg-primary-band flex items-center gap-4 rounded-lg p-4">
            <span className="bg-primary text-primary-foreground flex size-10 shrink-0 items-center justify-center rounded-full">
              <CheckIcon className="size-5" aria-hidden />
            </span>
            <div>
              <p className="font-semibold">{t("paid")}</p>
              <p className="text-muted-foreground text-sm">
                {t("subscription")}
              </p>
            </div>
          </div>
          <ArrowDownIcon
            className="text-primary-text mx-auto my-4 size-5"
            aria-hidden
          />
        </>
      )}
      <dl className="divide-border divide-y text-sm">
        {(["purchase", "deduction", "balance"] as const).map((key, i) => (
          <div
            key={key}
            className="flex items-center justify-between gap-4 py-3"
          >
            <dt className="text-muted-foreground">{t(key)}</dt>
            <dd
              data-numeric
              className={cn("font-semibold", i === 0 && "text-primary-text")}
            >
              {["+100", "−5", "95"][i]}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function UsagePreview() {
  const t = useTranslations("LandingPreview");
  return (
    <div className="landing-frame p-5 sm:p-7">
      <div className="mb-6 flex items-center justify-between gap-3">
        <p className="font-semibold">{t("usage")}</p>
        <span className="text-muted-foreground text-xs">{t("sample")}</span>
      </div>
      <table className="w-full text-left text-sm">
        <caption className="sr-only">
          {t("usage")} · {t("sample")}
        </caption>
        <thead className="bg-muted text-muted-foreground">
          <tr>
            {(["type", "credits", "status"] as const).map((key) => (
              <th key={key} scope="col" className="px-3 py-3 font-medium">
                {t(key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-border divide-y">
          {(
            ["textGeneration", "imageGeneration", "imageGeneration"] as const
          ).map((key, i) => (
            <tr key={i}>
              <td className="px-3 py-4">{t(key)}</td>
              <td data-numeric className="px-3 py-4">
                {i === 0 ? 1 : 5}
              </td>
              <td className={cn("px-3 py-4", i === 2 && "text-warning")}>
                {t(i === 2 ? "refunded" : "completed")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** An explicitly labeled, local-only preview. Switching tabs never invokes a model. */
export function StudioPreview({ gallery = false }: { gallery?: boolean }) {
  const t = useTranslations("LandingPreview");
  const id = useId();
  const tabs = gallery
    ? (["text", "image", "video"] as const)
    : (["generate", "history"] as const);
  const [active, setActive] = useState<string>(gallery ? "image" : "generate");
  const showImages = active === "image" || active === "generate";
  return (
    <div
      className={cn("landing-studio-wrap", !gallery && "landing-studio-hero")}
    >
      <div className="landing-frame p-4 sm:p-6">
        <div className="mb-5 flex items-center justify-between gap-3">
          <p className={cn("font-semibold", !gallery && "text-xl sm:text-2xl")}>
            {t(gallery ? "aiTitle" : "studio")}
          </p>
          <span className="text-muted-foreground shrink-0 text-xs">
            {t("sample")}
          </span>
        </div>
        <div
          className={cn(
            !gallery && "bg-background rounded-xl border p-3 sm:p-4",
          )}
        >
          <div
            role="tablist"
            aria-label={t(gallery ? "aiTitle" : "studio")}
            className="border-border mb-5 flex gap-1 border-b"
          >
            {tabs.map((key, index) => (
              <button
                key={key}
                type="button"
                role="tab"
                id={id + key}
                aria-selected={active === key}
                aria-controls={id + "panel"}
                tabIndex={active === key ? 0 : -1}
                className={cn(
                  "focus-visible:outline-ring min-h-11 border-b-2 px-4 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2",
                  active === key
                    ? "border-primary text-primary-text"
                    : "text-muted-foreground border-transparent",
                )}
                onClick={() => setActive(key)}
                onKeyDown={(e) => {
                  let next: number | undefined;
                  if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
                  if (e.key === "ArrowLeft")
                    next = (index - 1 + tabs.length) % tabs.length;
                  if (e.key === "Home") next = 0;
                  if (e.key === "End") next = tabs.length - 1;
                  if (next === undefined) return;
                  e.preventDefault();
                  const tab = tabs[next]!;
                  setActive(tab);
                  document.getElementById(id + tab)?.focus();
                }}
              >
                {t(key)}
              </button>
            ))}
          </div>
          <div
            role="tabpanel"
            id={id + "panel"}
            aria-labelledby={id + active}
            tabIndex={0}
            className="outline-ring focus-visible:outline-2"
          >
            {active === "generate" && (
              <div className="mb-4 text-sm">
                <p className="mb-2 font-medium">{t("promptLabel")}</p>
                <p className="text-muted-foreground rounded-lg border px-3 py-3">
                  {t("prompt")}
                </p>
              </div>
            )}
            {showImages ? (
              <>
                <div className={cn("grid gap-3", gallery && "grid-cols-2")}>
                  <Image
                    src="/landing/perfume.webp"
                    alt={t("perfumeAlt")}
                    width={1536}
                    height={1024}
                    sizes={
                      gallery
                        ? "(min-width: 1024px) 280px, 45vw"
                        : "(min-width: 1024px) 600px, 90vw"
                    }
                    loading={gallery ? "lazy" : "eager"}
                    fetchPriority={gallery ? "auto" : "high"}
                    className={cn(
                      "h-auto w-full rounded-lg object-cover",
                      gallery ? "aspect-[4/5]" : "aspect-[3/2]",
                    )}
                  />
                  {gallery && (
                    <Image
                      src="/landing/skincare.webp"
                      alt={t("skincareAlt")}
                      width={1122}
                      height={1402}
                      sizes="(min-width: 1024px) 280px, 45vw"
                      className="aspect-[4/5] h-auto w-full rounded-lg object-cover"
                    />
                  )}
                </div>
                <div
                  className={cn(
                    "mt-4 flex flex-wrap items-center justify-between gap-3 text-xs sm:text-sm",
                    !gallery && "lg:pl-32",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <CheckIcon
                      className="bg-primary text-primary-foreground size-6 rounded-full p-1"
                      aria-hidden
                    />
                    {t(gallery ? "generations" : "completed")}
                  </span>
                  <span className="text-muted-foreground">
                    {t(gallery ? "sample" : "cost")}
                  </span>
                </div>
              </>
            ) : active === "history" ? (
              <UsagePreview />
            ) : (
              <div className="bg-primary-band flex min-h-64 flex-col justify-center rounded-lg p-6">
                <p className="text-primary-text mb-3 text-xs font-semibold">
                  {t("sample")}
                </p>
                <p className="text-xl leading-relaxed font-medium">
                  {t(active === "text" ? "textExample" : "videoExample")}
                </p>
                <p className="text-muted-foreground mt-4 text-sm">
                  {t(active === "text" ? "textNote" : "videoNote")}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
      {!gallery && active === "generate" && <CreditLedger compact />}
    </div>
  );
}
