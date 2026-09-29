"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";

import { uploadFile, UploadFailedError } from "./client";
import type { UploadedFile } from "./service";

// Error codes with dedicated copy (Dashboard.upload.errors in messages); everything else shows unknown.
const knownErrors = [
  "invalid_type",
  "invalid_size",
  "too_large",
  "rate_limited",
  "upload_not_configured",
  "put_failed",
  "mismatch",
] as const;
type KnownError = (typeof knownErrors)[number] | "unknown";

function errorCode(error: unknown): KnownError {
  const code = error instanceof UploadFailedError ? error.code : "unknown";
  return (knownErrors as readonly string[]).includes(code)
    ? (code as KnownError)
    : "unknown";
}

/**
 * Upload example in the dashboard, used to verify the R2 setup; your product code can follow how
 * it uses uploadFile() to build its own UI.
 */
export function UploadExample({ accept }: { accept: string[] }) {
  const t = useTranslations("Dashboard.upload");
  const [state, setState] = useState<
    | { status: "idle" | "uploading" }
    | { status: "done"; file: UploadedFile }
    | { status: "error"; code: KnownError }
  >({ status: "idle" });

  async function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setState({ status: "uploading" });
    try {
      setState({ status: "done", file: await uploadFile(file) });
    } catch (error) {
      setState({ status: "error", code: errorCode(error) });
    }
  }

  return (
    <section className="panel flex flex-col gap-3 p-6">
      <div className="space-y-1">
        <h2 className="heading-display text-lg">{t("title")}</h2>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </div>
      <Label htmlFor="upload-example" className="sr-only">
        {t("choose")}
      </Label>
      <Input
        id="upload-example"
        type="file"
        accept={accept.join(",")}
        disabled={state.status === "uploading"}
        onChange={onChange}
        className="max-w-sm"
      />
      {state.status === "uploading" && (
        <p role="status" className="text-muted-foreground text-sm">
          {t("uploading")}
        </p>
      )}
      {state.status === "done" && (
        <p role="status" className="text-sm">
          {t("done")}{" "}
          <a
            href={`/api/upload/files/${state.file.id}`}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-4"
          >
            {state.file.key}
          </a>
        </p>
      )}
      {state.status === "error" && (
        <p role="alert" className="text-destructive text-sm">
          {t(`errors.${state.code}`)}
        </p>
      )}
    </section>
  );
}
