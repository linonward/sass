import type { UploadedFile, UploadError } from "./service";

/** Why an upload failed: the error code returned by the API, or the browser's direct PUT to R2 failing (`put_failed`). */
export class UploadFailedError extends Error {
  constructor(
    readonly code:
      UploadError | "rate_limited" | "unauthorized" | "put_failed" | "unknown",
    readonly status: number,
  ) {
    super(`upload failed: ${code} (${status})`);
    this.name = "UploadFailedError";
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as {
    error?: UploadFailedError["code"];
  };
  if (!response.ok) {
    throw new UploadFailedError(data.error ?? "unknown", response.status);
  }
  return data as T;
}

/**
 * Uploads one file from the browser: request a presigned URL → PUT directly to R2 → confirm.
 * Type and size are validated server-side against `upload` in `site.config.ts`; throws
 * UploadFailedError on failure.
 */
export async function uploadFile(file: File): Promise<UploadedFile> {
  const presigned = await post<{
    fileId: string;
    uploadUrl: string;
    headers: Record<string, string>;
  }>("/api/upload/presign", { mime: file.type, size: file.size });

  const put = await fetch(presigned.uploadUrl, {
    method: "PUT",
    headers: presigned.headers,
    body: file,
  });
  if (!put.ok) throw new UploadFailedError("put_failed", put.status);

  const { file: uploaded } = await post<{ file: UploadedFile }>(
    "/api/upload/complete",
    { fileId: presigned.fileId },
  );
  return uploaded;
}
