"use client";

import { useTranslations } from "next-intl";

import { UploadField } from "./upload-field";

/**
 * Upload example in the dashboard, used to verify the R2 setup. Your product code uses UploadField
 * the same way, or useUpload() when it needs its own UI.
 */
export function UploadExample({
  accept,
  maxSize,
}: {
  accept: string[];
  maxSize: number;
}) {
  const t = useTranslations("Dashboard.upload");
  return (
    <section className="panel flex flex-col gap-3 p-6">
      <div className="space-y-1">
        <h2 className="heading-display text-lg">{t("title")}</h2>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </div>
      <UploadField accept={accept} maxSize={maxSize} className="max-w-md" />
    </section>
  );
}
