"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { captureError } from "@/core/observability/sentry";
import { Button } from "@/core/ui/button";

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const t = useTranslations("Error");

  useEffect(() => {
    console.error(error);
    captureError(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      {/* Error boundaries must be client components and can't export metadata, so per the docs use a
          React <title>. React inserts it into <head> ahead of the existing <title>, and browsers take
          the first one, so it overrides the title of the page that was replaced. */}
      <title>{t("title")}</title>
      <h1 className="heading-display text-4xl sm:text-5xl">{t("title")}</h1>
      <p className="text-muted-foreground text-lg text-pretty">
        {t("description")}
      </p>
      {error.digest && (
        <p className="text-muted-foreground font-mono text-xs">
          {t("id", { digest: error.digest })}
        </p>
      )}
      {/* Marketing CTAs are 44px stickers with a lip; the default 32px is also below the touch-target
          minimum in design.md. */}
      <Button size="marketing" tone="primary" onClick={() => retry()}>
        {t("retry")}
      </Button>
    </main>
  );
}
