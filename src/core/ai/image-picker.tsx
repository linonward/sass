"use client";

import { CheckIcon, Loader2Icon, UploadIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef } from "react";

import { cn } from "@/core/lib/utils";
import { Button } from "@/core/ui/button";
import { useUpload } from "@/core/upload/use-upload";

import type { Generation } from "./image";

export type PickedImage = { fileId: string; url: string };

// What the image models accept as input; the upload itself is still checked against
// `upload.allowedMimeTypes` on the server.
const imageTypes = ["image/png", "image/jpeg", "image/webp"];

/**
 * Picks one of the user's images as model input: a recent generation or a fresh upload. Used for
 * the first frame of image-to-video and the reference image of image editing; the server checks
 * ownership again (see owned-image.ts), so this only decides what gets sent.
 */
export function ImagePicker({
  legend,
  images,
  value,
  onChange,
  disabled,
  removable = false,
}: {
  legend: string;
  images: Generation[];
  value: PickedImage | null;
  onChange: (image: PickedImage | null) => void;
  disabled?: boolean;
  // Optional inputs get a "remove" button so the user can go back to prompt-only.
  removable?: boolean;
}) {
  const t = useTranslations("Playground.picker");
  const tUpload = useTranslations("Upload");
  const fileInput = useRef<HTMLInputElement>(null);
  const { state, select, cancel, retry } = useUpload({
    accept: imageTypes,
    onUploaded: (uploaded) =>
      onChange({ fileId: uploaded.id, url: uploaded.url }),
  });
  const uploading = state.status === "uploading";

  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {images.slice(0, 8).map((image) => {
          const selected = value?.fileId === image.fileId;
          return (
            <button
              key={image.id}
              type="button"
              onClick={() => onChange({ fileId: image.fileId, url: image.url })}
              aria-pressed={selected}
              aria-label={t("useImage", { prompt: image.prompt })}
              className={cn(
                "relative size-16 overflow-hidden rounded-md border",
                selected && "ring-primary ring-2",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.url} alt="" className="size-full object-cover" />
              {selected && (
                <CheckIcon
                  className="bg-primary text-primary-foreground absolute top-1 right-1 size-4 rounded-full p-0.5"
                  aria-hidden
                />
              )}
            </button>
          );
        })}
        {value && !images.some((i) => i.fileId === value.fileId) && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value.url}
            alt={t("uploaded")}
            className="ring-primary size-16 rounded-md border object-cover ring-2"
          />
        )}
        <Button
          type="button"
          variant="outline"
          className="size-16 flex-col gap-1 text-xs"
          onClick={() => fileInput.current?.click()}
          disabled={uploading}
        >
          {uploading ? (
            <Loader2Icon className="animate-spin" aria-hidden />
          ) : (
            <UploadIcon aria-hidden />
          )}
          {uploading && state.progress !== null
            ? `${Math.round(state.progress * 100)}%`
            : t("upload")}
        </Button>
        {uploading && (
          <Button
            type="button"
            variant="ghost"
            className="size-16 flex-col gap-1 text-xs"
            onClick={cancel}
          >
            <XIcon aria-hidden />
            {tUpload("cancel")}
          </Button>
        )}
        {removable && value && (
          <Button
            type="button"
            variant="ghost"
            className="size-16 flex-col gap-1 text-xs"
            onClick={() => onChange(null)}
          >
            <XIcon aria-hidden />
            {t("remove")}
          </Button>
        )}
        <input
          ref={fileInput}
          type="file"
          accept={imageTypes.join(",")}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) select(file);
          }}
        />
      </div>
      {state.status === "error" && (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-destructive text-sm">
            {tUpload(`errors.${state.code}`)}
          </p>
          {state.retryFile && (
            <Button type="button" variant="outline" size="sm" onClick={retry}>
              {tUpload("retry")}
            </Button>
          )}
        </div>
      )}
    </fieldset>
  );
}
