import { and, eq } from "drizzle-orm";

import type { UploadConfig } from "@/core/config/schema";
import type { Database } from "@/core/db";
import { files, type FileRecord } from "@/core/db/schema";

import type { ObjectStorage } from "./storage";
import { buildObjectKey, validateUpload } from "./validate";

/** Lifetime of a presigned PUT URL (seconds). */
export const PUT_URL_EXPIRES_IN = 10 * 60;
/** Lifetime of a signed GET URL for private files (seconds). */
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
  // null when R2 isn't configured; the API returns 503.
  storage: ObjectStorage | null;
  config: UploadConfig;
  // Public origin when upload.public is true, e.g. https://files.example.com.
  publicUrl?: string;
};

/** File info returned to the client. For private files, url is a time-limited signed URL. */
export type UploadedFile = {
  id: string;
  key: string;
  size: number;
  mime: string;
  url: string;
};

/**
 * Validates type and size, records a pending row, and returns a presigned PUT URL.
 * The browser must send the Content-Type from `headers` when uploading; if the size or type
 * differs, R2 rejects it (the signature covers both headers).
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
    // insert … returning always returns the row just inserted; that's what this non-null
    // assertion means.
    fileId: file!.id,
    key,
    uploadUrl,
    headers: { "Content-Type": checked.value.mime },
    expiresIn: PUT_URL_EXPIRES_IN,
  };
}

/**
 * Confirms an upload: the object must exist with the size and type that were signed, then the row
 * is marked uploaded. Confirming again returns the same result. On a size or type mismatch the
 * object is deleted (the row stays pending) and 422 is returned.
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
  // The row was just found above, so update … returning is guaranteed to return it.
  return { ok: true, file: await toUploadedFile(deps, updated!) };
}

/**
 * URL of a file the user has uploaded; null if it doesn't exist, belongs to someone else, or
 * hasn't been confirmed yet.
 */
export async function getFileUrl(
  deps: UploadDeps,
  { userId, fileId }: { userId: string; fileId: unknown },
): Promise<string | null> {
  if (!deps.storage) return null;
  const file = await findOwnFile(deps.db, userId, fileId);
  if (!file || file.status !== "uploaded") return null;
  return fileUrl(deps, file.key);
}

/** Public files use the public origin; private files use a time-limited signed GET URL. */
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
