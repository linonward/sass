import { and, eq } from "drizzle-orm";

import type { UploadConfig } from "@/core/config/schema";
import type { Database } from "@/core/db";
import { files, type FileRecord } from "@/core/db/schema";

import type { ObjectStorage } from "./storage";
import { buildObjectKey, validateUpload } from "./validate";

/** 预签名 PUT 地址的有效期（秒）。 */
export const PUT_URL_EXPIRES_IN = 10 * 60;
/** 私有文件签名 GET 地址的有效期（秒）。 */
export const GET_URL_EXPIRES_IN = 60 * 60;

export type UploadError =
  | "upload_not_configured"
  | "invalid_type"
  | "invalid_size"
  | "too_large"
  | "not_found"
  | "not_uploaded"
  | "mismatch";

type Fail = { ok: false; error: UploadError; status: number };

const fail = (error: UploadError, status: number): Fail => ({
  ok: false,
  error,
  status,
});

export type UploadDeps = {
  db: Database;
  // 没有配置 R2 时为 null，接口返回 503。
  storage: ObjectStorage | null;
  config: UploadConfig;
  // upload.public 为 true 时的公开域名，例如 https://files.example.com。
  publicUrl?: string;
};

/** 客户端拿到的文件信息。url 对私有文件是有时效的签名地址。 */
export type UploadedFile = {
  id: string;
  key: string;
  size: number;
  mime: string;
  url: string;
};

/**
 * 校验类型和大小，登记一条 pending 记录，返回预签名 PUT 地址。
 * 浏览器上传时必须带上 `headers` 里的 Content-Type；大小不同或类型不同，R2 会拒绝（签名覆盖了这两个头）。
 */
export async function presignUpload(
  { db, storage, config }: UploadDeps,
  { userId, mime, size }: { userId: string; mime: unknown; size: unknown },
  now = new Date(),
): Promise<
  | {
      ok: true;
      fileId: string;
      key: string;
      uploadUrl: string;
      headers: { "Content-Type": string };
      expiresIn: number;
    }
  | Fail
> {
  if (!storage) return fail("upload_not_configured", 503);
  const checked = validateUpload({ mime, size }, config);
  if (!checked.ok) {
    return fail(checked.error, checked.error === "too_large" ? 413 : 400);
  }

  const key = buildObjectKey({ userId, mime: checked.value.mime, now });
  const uploadUrl = await storage.presignPut({
    key,
    mime: checked.value.mime,
    size: checked.value.size,
    expiresIn: PUT_URL_EXPIRES_IN,
  });
  const [file] = await db
    .insert(files)
    .values({ userId, key, ...checked.value })
    .returning({ id: files.id });

  return {
    ok: true,
    // insert … returning 必然带回刚插进去的那一行，这里的非空断言是这个意思。
    fileId: file!.id,
    key,
    uploadUrl,
    headers: { "Content-Type": checked.value.mime },
    expiresIn: PUT_URL_EXPIRES_IN,
  };
}

/**
 * 确认上传：对象必须存在，大小和类型与签发时一致，然后把记录改为 uploaded。
 * 重复确认返回同样的结果。大小或类型不一致时删除对象（记录保留为 pending），返回 422。
 */
export async function completeUpload(
  deps: UploadDeps,
  { userId, fileId }: { userId: string; fileId: unknown },
): Promise<{ ok: true; file: UploadedFile } | Fail> {
  const { db, storage } = deps;
  if (!storage) return fail("upload_not_configured", 503);

  const file = await findOwnFile(db, userId, fileId);
  if (!file) return fail("not_found", 404);
  if (file.status === "uploaded") {
    return { ok: true, file: await toUploadedFile(deps, file) };
  }

  const object = await storage.head(file.key);
  if (!object) return fail("not_uploaded", 409);
  if (object.size !== file.size || baseMime(object.mime) !== file.mime) {
    await storage.delete(file.key);
    return fail("mismatch", 422);
  }

  const [updated] = await db
    .update(files)
    .set({ status: "uploaded" })
    .where(eq(files.id, file.id))
    .returning();
  // 上面刚查到这条记录、update … returning 也就必然带回它。
  return { ok: true, file: await toUploadedFile(deps, updated!) };
}

/** 用户自己已上传的文件的访问地址；不存在、不属于该用户或还没确认时返回 null。 */
export async function getFileUrl(
  deps: UploadDeps,
  { userId, fileId }: { userId: string; fileId: unknown },
): Promise<string | null> {
  if (!deps.storage) return null;
  const file = await findOwnFile(deps.db, userId, fileId);
  if (!file || file.status !== "uploaded") return null;
  return fileUrl(deps, file.key);
}

/** 公开文件用公开域名，私有文件用有时效的签名 GET 地址。 */
export async function fileUrl(
  {
    storage,
    config,
    publicUrl,
  }: Pick<UploadDeps, "storage" | "config" | "publicUrl">,
  key: string,
) {
  if (config.public) {
    if (!publicUrl)
      throw new Error("R2_PUBLIC_URL is required when upload.public is true");
    return `${publicUrl.replace(/\/+$/, "")}/${key}`;
  }
  if (!storage) throw new Error("R2 storage is not configured");
  return storage.presignGet({ key, expiresIn: GET_URL_EXPIRES_IN });
}

async function findOwnFile(db: Database, userId: string, fileId: unknown) {
  if (typeof fileId !== "string" || !fileId) return undefined;
  const [file] = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId)));
  return file;
}

async function toUploadedFile(
  deps: UploadDeps,
  file: FileRecord,
): Promise<UploadedFile> {
  return {
    id: file.id,
    key: file.key,
    size: file.size,
    mime: file.mime,
    url: await fileUrl(deps, file.key),
  };
}

// "image/png; charset=binary" → "image/png"
function baseMime(mime: string | null) {
  const [type] = mime?.split(";") ?? [];
  return type ? type.trim().toLowerCase() : null;
}
