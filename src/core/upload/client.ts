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

async function post<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const data = (await response.json().catch(() => ({}))) as {
    error?: UploadFailedError["code"];
  };
  if (!response.ok) {
    throw new UploadFailedError(data.error ?? "unknown", response.status);
  }
  return data as T;
}

/** Whether an error is the rejection from a canceled upload (`signal` aborted). */
export function isUploadAborted(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

const aborted = () => new DOMException("upload aborted", "AbortError");

/**
 * The direct PUT to R2. `fetch` can't report upload progress, so when a caller wants progress the
 * PUT goes through XMLHttpRequest and its `upload.onprogress`.
 */
function put(
  url: string,
  headers: Record<string, string>,
  file: File,
  { signal, onProgress }: UploadOptions,
): Promise<number> {
  if (!onProgress) {
    return fetch(url, { method: "PUT", headers, body: file, signal }).then(
      (response) => response.status,
    );
  }
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(aborted());
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) {
      xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => resolve(xhr.status);
    // A network or CORS failure has no status; report it like a failed PUT.
    xhr.onerror = () => resolve(0);
    xhr.onabort = () => reject(aborted());
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

export type UploadOptions = {
  /** Cancels the upload; the promise rejects with an AbortError (see isUploadAborted). */
  signal?: AbortSignal;
  /** Called with 0–1 while the file is sent to storage. */
  onProgress?: (fraction: number) => void;
};

/**
 * Uploads one file from the browser: request a presigned URL → PUT directly to R2 → confirm.
 * Type and size are validated server-side against `upload` in `site.config.ts`; throws
 * UploadFailedError on failure. Once `signal` is aborted, nothing further is sent: in particular,
 * the upload is never confirmed.
 */
export async function uploadFile(
  file: File,
  options: UploadOptions = {},
): Promise<UploadedFile> {
  const { signal } = options;
  const presigned = await post<{
    fileId: string;
    uploadUrl: string;
    headers: Record<string, string>;
  }>("/api/upload/presign", { mime: file.type, size: file.size }, signal);

  const status = await put(
    presigned.uploadUrl,
    presigned.headers,
    file,
    options,
  );
  if (status < 200 || status >= 300) {
    throw new UploadFailedError("put_failed", status);
  }
  if (signal?.aborted) throw aborted();

  const { file: uploaded } = await post<{ file: UploadedFile }>(
    "/api/upload/complete",
    { fileId: presigned.fileId },
    signal,
  );
  return uploaded;
}

/**
 * The same type and size checks the server makes, run before any request so an obviously wrong
 * file fails instantly. The server still validates; this only saves a round trip.
 */
export function precheckUpload(
  file: Pick<File, "type" | "size">,
  { accept, maxSize }: { accept?: readonly string[]; maxSize?: number },
): "invalid_type" | "invalid_size" | "too_large" | null {
  if (accept && !accept.includes(file.type.toLowerCase())) {
    return "invalid_type";
  }
  if (file.size <= 0) return "invalid_size";
  if (maxSize !== undefined && file.size > maxSize) return "too_large";
  return null;
}
