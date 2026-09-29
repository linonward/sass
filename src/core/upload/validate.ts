import {
  uploadMimeTypes,
  type UploadConfig,
  type UploadMimeType,
} from "@/core/config/schema";

export type UploadRequest = { mime: UploadMimeType; size: number };

export type UploadValidationError =
  "invalid_type" | "invalid_size" | "too_large";

/**
 * Validates the type and size (bytes) of a requested upload. The type must be in
 * `upload.allowedMimeTypes`; the size must be a positive integer no greater than
 * `upload.maxFileSize`.
 */
export function validateUpload(
  input: { mime?: unknown; size?: unknown },
  config: Pick<UploadConfig, "allowedMimeTypes" | "maxFileSize">,
):
  | { ok: true; value: UploadRequest }
  | { ok: false; error: UploadValidationError } {
  const mime =
    typeof input.mime === "string" ? input.mime.trim().toLowerCase() : "";
  if (!(config.allowedMimeTypes as string[]).includes(mime)) {
    return { ok: false, error: "invalid_type" };
  }
  const { size } = input;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0) {
    return { ok: false, error: "invalid_size" };
  }
  if (size > config.maxFileSize) return { ok: false, error: "too_large" };
  return { ok: true, value: { mime: mime as UploadMimeType, size } };
}

/**
 * Object key: `<userId>/<yyyy-mm>/<uuid>.<ext>`. The month is UTC; the extension comes from the
 * MIME type, never from the user's file name.
 */
export function buildObjectKey({
  userId,
  mime,
  now = new Date(),
  id = crypto.randomUUID(),
}: {
  userId: string;
  mime: UploadMimeType;
  now?: Date;
  id?: string;
}) {
  if (!/^[A-Za-z0-9_-]+$/.test(userId)) {
    throw new Error(`userId "${userId}" is not safe for an object key`);
  }
  const month = now.toISOString().slice(0, 7);
  return `${userId}/${month}/${id}.${uploadMimeTypes[mime]}`;
}
