"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";

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
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-muted-foreground">{t("description")}</p>
      {error.digest && (
        <p className="text-muted-foreground font-mono text-xs">
          {t("id", { digest: error.digest })}
        </p>
      )}
      <Button onClick={() => retry()}>{t("retry")}</Button>
    </main>
  );
}
