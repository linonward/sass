import { and, eq } from "drizzle-orm";

import type { Database } from "@/core/db/client";
import { files } from "@/core/db/schema";

/**
 * Resolves a user-supplied file id to a URL the provider can fetch, but only for the caller's own,
 * fully uploaded image. Anything else (someone else's file, a pending upload, a PDF, a missing or
 * non-string id) yields null, and callers answer 400 before reserving credits.
 *
 * Shared by image-to-video (first frame) and image editing (reference image) so both apply the
 * same rule.
 */
export function createOwnedImageUrl(
  getDb: () => Database,
  fileUrl: (key: string) => Promise<string>,
) {
  return async function ownedImageUrl(
    userId: string,
    fileId: unknown,
  ): Promise<string | null> {
    if (typeof fileId !== "string" || !fileId) return null;
    const [file] = await getDb()
      .select({ key: files.key, mime: files.mime, status: files.status })
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.userId, userId)));
    if (
      !file ||
      file.status !== "uploaded" ||
      !file.mime.startsWith("image/")
    ) {
      return null;
    }
    return fileUrl(file.key);
  };
}
