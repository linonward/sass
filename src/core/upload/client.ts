import type { UploadedFile, UploadError } from "./service";

/** 上传失败的原因：接口返回的错误码，或浏览器直传 R2 失败（`put_failed`）。 */
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
 * 浏览器端上传一个文件：申请预签名地址 → 直接 PUT 到 R2 → 确认。
 * 类型和大小由服务端按 `site.config.ts` 的 `upload` 校验；失败时抛出 UploadFailedError。
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
