import {
  uploadMimeTypes,
  type UploadConfig,
  type UploadMimeType,
} from "@/core/config/schema";

export type UploadRequest = { mime: UploadMimeType; size: number };

export type UploadValidationError =
  "invalid_type" | "invalid_size" | "too_large";

/**
 * 校验请求上传的类型和大小（字节）。类型必须在 `upload.allowedMimeTypes` 里，
 * 大小必须是正整数且不超过 `upload.maxFileSize`。
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
 * 对象 key：`<userId>/<yyyy-mm>/<uuid>.<ext>`。月份按 UTC；扩展名由 MIME 类型决定，不取用户的文件名。
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
