import type { Database } from "@/core/db";
import type { ObjectStorage } from "@/core/upload/storage";

import { findDownload } from "./queries";

/** 下载地址的有效期：够浏览器开始下载，转发出去也很快失效。 */
export const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

export type DownloadRouteContext = {
  enabled: boolean;
  getUserId: (request: Request) => Promise<string | null>;
  db: () => Database;
  storage: () => ObjectStorage | null;
};

/**
 * GET /api/downloads/<版本 id>：校验登录和授权，签一个 5 分钟的私有地址并跳过去。
 * 文件本身不经过我们的服务器；地址每次现签，下载页和邮件里的链接永远不会过期。
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
