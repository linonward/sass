"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  isUploadAborted,
  precheckUpload,
  uploadFile,
  UploadFailedError,
} from "./client";
import type { UploadedFile } from "./service";

// Error codes with dedicated copy (Upload.errors in messages); everything else shows unknown.
const knownErrors = [
  "invalid_type",
  "invalid_size",
  "too_large",
  "rate_limited",
  "upload_not_configured",
  "put_failed",
  "mismatch",
] as const;
export type UploadErrorCode = (typeof knownErrors)[number] | "unknown";

export function uploadErrorCode(error: unknown): UploadErrorCode {
  const code = error instanceof UploadFailedError ? error.code : "unknown";
  return (knownErrors as readonly string[]).includes(code)
    ? (code as UploadErrorCode)
    : "unknown";
}

export type UploadState =
  | { status: "idle"; canceled?: boolean }
  | {
      status: "uploading";
      file: File;
      preview: string | null;
      /** 0–1, or null before the first progress event. */
      progress: number | null;
    }
  | {
      status: "done";
      file: File;
      preview: string | null;
      uploaded: UploadedFile;
    }
  | {
      status: "error";
      code: UploadErrorCode;
      preview: string | null;
      /** Kept when trying the same file again could help; null when the file itself was rejected. */
      retryFile: File | null;
    };

/**
 * Upload state for one file: client-side precheck, upload with progress, cancel, retry and a local
 * image preview. UploadField is the ready-made UI on top of it; build your own UI on the hook when
 * the field doesn't fit (ImagePicker does this).
 */
export function useUpload({
  accept,
  maxSize,
  onUploaded,
}: {
  /** Allowed MIME types; checked before any request. Usually `upload.allowedMimeTypes`. */
  accept?: readonly string[];
  /** Maximum size in bytes; checked before any request. Usually `upload.maxFileSize`. */
  maxSize?: number;
  onUploaded?: (file: UploadedFile) => void;
}) {
  const [state, setState] = useState<UploadState>({ status: "idle" });
  const controller = useRef<AbortController | null>(null);
  const preview = useRef<string | null>(null);
  // Bumped on every new upload, so a slow earlier one can't overwrite the state of a later one.
  const run = useRef(0);
  const onUploadedRef = useRef(onUploaded);
  useEffect(() => {
    onUploadedRef.current = onUploaded;
  });

  const setPreview = useCallback((file: File | null) => {
    if (preview.current) URL.revokeObjectURL(preview.current);
    preview.current =
      file && file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
    return preview.current;
  }, []);

  useEffect(
    () => () => {
      controller.current?.abort();
      if (preview.current) URL.revokeObjectURL(preview.current);
    },
    [],
  );

  const start = useCallback(
    async (file: File, image: string | null) => {
      controller.current?.abort();
      const current = new AbortController();
      controller.current = current;
      const id = ++run.current;
      setState({ status: "uploading", file, preview: image, progress: null });
      try {
        const uploaded = await uploadFile(file, {
          signal: current.signal,
          onProgress: (progress) => {
            if (run.current === id) {
              setState({ status: "uploading", file, preview: image, progress });
            }
          },
        });
        if (run.current !== id) return;
        setState({ status: "done", file, preview: image, uploaded });
        onUploadedRef.current?.(uploaded);
      } catch (error) {
        if (run.current !== id) return;
        if (isUploadAborted(error)) {
          setPreview(null);
          setState({ status: "idle", canceled: true });
          return;
        }
        setState({
          status: "error",
          code: uploadErrorCode(error),
          preview: image,
          retryFile: file,
        });
      }
    },
    [setPreview],
  );

  const select = useCallback(
    (file: File) => {
      const rejected = precheckUpload(file, { accept, maxSize });
      if (rejected) {
        controller.current?.abort();
        run.current++;
        setState({
          status: "error",
          code: rejected,
          preview: setPreview(null),
          retryFile: null,
        });
        return;
      }
      void start(file, setPreview(file));
    },
    [accept, maxSize, setPreview, start],
  );

  const cancel = useCallback(() => controller.current?.abort(), []);

  const retry = useCallback(() => {
    if (state.status === "error" && state.retryFile) {
      void start(state.retryFile, state.preview);
    }
  }, [state, start]);

  const reset = useCallback(() => {
    controller.current?.abort();
    run.current++;
    setPreview(null);
    setState({ status: "idle" });
  }, [setPreview]);

  return { state, select, cancel, retry, reset };
}
