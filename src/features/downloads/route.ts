import type { Database } from "@/core/db";
import type { ObjectStorage } from "@/core/upload/storage";

import { findDownload } from "./queries";

/** Lifetime of a download URL: long enough for the browser to start the download, short enough that a forwarded link dies quickly. */
export const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

export type DownloadRouteContext = {
  enabled: boolean;
  getUserId: (request: Request) => Promise<string | null>;
  db: () => Database;
  storage: () => ObjectStorage | null;
};

/**
 * GET /api/downloads/<version id>: checks sign-in and access, signs a private URL valid for 5
 * minutes, and redirects to it. The file itself never passes through our server; the URL is signed
 * fresh each time, so links on the downloads page and in emails never expire.
 */
export async function handleDownload(
  request: Request,
  releaseId: string,
  ctx: DownloadRouteContext,
): Promise<Response> {
  if (!ctx.enabled) return new Response("Not found", { status: 404 });
  const userId = await ctx.getUserId(request);
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const release = await findDownload(ctx.db(), userId, releaseId);
  if (!release) return new Response("Not found", { status: 404 });

  const storage = ctx.storage();
  if (!storage) {
    return new Response("Storage not configured", { status: 503 });
  }
  const url = await storage.presignGet({
    key: release.objectKey,
    expiresIn: DOWNLOAD_URL_TTL_SECONDS,
  });
  return new Response(null, {
    status: 302,
    headers: { Location: url, "Cache-Control": "no-store" },
  });
}
