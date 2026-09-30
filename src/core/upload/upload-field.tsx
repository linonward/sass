"use client";

import { FileIcon, UploadIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";

import { cn } from "@/core/lib/utils";
import { Button } from "@/core/ui/button";
import { Progress } from "@/core/ui/progress";

import type { UploadedFile } from "./service";
import { useUpload } from "./use-upload";

/** `image/png` → `PNG`, for the hint under the drop zone. */
const typeLabel = (mime: string) =>
  (mime.split("/")[1] ?? mime).toUpperCase().replace("JPEG", "JPG");

const sizeLabel = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${Math.round(bytes / (1024 * 1024))} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * One-file upload field: click or drop to choose, instant type / size precheck, image preview,
 * progress, cancel and retry. With `name`, the uploaded file's id is submitted with the surrounding
 * form as a hidden field; otherwise read it from `onChange`. The server validates every upload
 * again, so the precheck only saves a round trip.
 */
export function UploadField({
  label,
  name,
  accept,
  maxSize,
  disabled,
  onChange,
  className,
}: {
  /** Accessible name of the drop zone; defaults to "Choose a file". */
  label?: string;
  name?: string;
  accept?: readonly string[];
  maxSize?: number;
  disabled?: boolean;
  onChange?: (file: UploadedFile | null) => void;
  className?: string;
}) {
  const t = useTranslations("Upload");
  const { state, select, cancel, retry, reset } = useUpload({
    accept,
    maxSize,
    onUploaded: onChange,
  });
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const hintId = useId();

  const choose = (file: File | undefined) => {
    if (file && !disabled) select(file);
  };

  const hint = [
    accept?.length ? accept.map(typeLabel).join(", ") : null,
    maxSize ? t("maxSize", { size: sizeLabel(maxSize) }) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const busy = state.status === "uploading";
  const showDropZone = state.status === "idle" || state.status === "error";
  const file =
    state.status === "uploading" || state.status === "done" ? state.file : null;
  const preview = state.status === "idle" ? null : state.preview;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {name && (
        <input
          type="hidden"
          name={name}
          value={state.status === "done" ? state.uploaded.id : ""}
        />
      )}
      <input
        ref={input}
        type="file"
        accept={accept?.join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          choose(event.target.files?.[0]);
          event.target.value = "";
        }}
      />

      {showDropZone && (
        <button
          type="button"
          disabled={disabled}
          aria-describedby={hint ? hintId : undefined}
          onClick={() => input.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            if (!disabled) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            choose(event.dataTransfer.files[0]);
          }}
          className={cn(
            "bg-card text-muted-foreground hover:bg-muted/60 focus-visible:border-ring focus-visible:ring-ring/50 flex w-full flex-col items-center gap-1 rounded-lg border border-dashed px-4 py-6 text-center text-sm transition-colors outline-none focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-50",
            dragging && "border-primary bg-primary-band text-foreground",
          )}
        >
          <UploadIcon className="size-5" aria-hidden />
          <span className="text-foreground font-medium">
            {label ?? t("choose")}
          </span>
          <span>{t("dropHint")}</span>
          {hint && (
            <span id={hintId} className="text-xs">
              {hint}
            </span>
          )}
        </button>
      )}

      {file && (
        <div className="bg-card flex items-center gap-3 rounded-lg border p-3">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview}
              alt=""
              className="size-12 shrink-0 rounded-md border object-cover"
            />
          ) : (
            <FileIcon
              className="text-muted-foreground size-5 shrink-0"
              aria-hidden
            />
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            {state.status === "done" ? (
              <a
                href={`/api/upload/files/${state.uploaded.id}`}
                target="_blank"
                rel="noreferrer"
                className="text-primary-text text-sm break-all underline underline-offset-4"
              >
                {file.name}
              </a>
            ) : (
              <span className="text-sm break-all">{file.name}</span>
            )}
            {state.status === "uploading" && (
              <Progress
                value={state.progress === null ? null : state.progress * 100}
                aria-label={t("progress", { name: file.name })}
              />
            )}
          </div>
          {busy ? (
            <Button type="button" variant="outline" size="sm" onClick={cancel}>
              {t("cancel")}
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => {
                reset();
                onChange?.(null);
              }}
            >
              {t("remove")}
            </Button>
          )}
        </div>
      )}

      {/* While the file row shows the name, the status is for screen readers only. */}
      <p
        role="status"
        className={cn(
          "text-muted-foreground text-sm empty:hidden",
          file && "sr-only",
        )}
      >
        {state.status === "uploading" &&
          t("uploading", { name: state.file.name })}
        {state.status === "done" && t("done", { name: state.file.name })}
        {state.status === "idle" && state.canceled && t("canceled")}
      </p>
      {state.status === "error" && (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-destructive text-sm">
            {t(`errors.${state.code}`)}
          </p>
          {state.retryFile && (
            <Button type="button" variant="outline" size="sm" onClick={retry}>
              {t("retry")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
