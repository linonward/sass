import type {
  RateLimitIdentifiers,
  RateLimitResult,
} from "@/core/ratelimit/limiter";
import { getClientIp, rateLimitResponse } from "@/core/ratelimit/limiter";

import {
  completeUpload,
  getFileUrl,
  presignUpload,
  type UploadDeps,
} from "./service";

/** 路由处理函数的依赖。生产由 ./routes.ts 绑定，测试里替换。 */
export type UploadRouteContext = {
  enabled: boolean;
  getUserId: (request: Request) => Promise<string | null>;
  checkRateLimit: (
    policy: string,
    identifiers: RateLimitIdentifiers,
  ) => Promise<RateLimitResult>;
  deps: () => UploadDeps;
};

const notFound = () => Response.json({ error: "not_found" }, { status: 404 });
const unauthorized = () =>
  Response.json({ error: "unauthorized" }, { status: 401 });

async function readJson(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  return body && typeof body === "object"
    ? (body as Record<string, unknown>)
    : {};
}

/**
 * `POST /api/upload/presign`，body：`{ mime, size }`。
 * 需要登录，走 `upload` 限流；返回 `{ fileId, key, uploadUrl, headers, expiresIn }`。
 */
export async function handlePresign(
  request: Request,
  context: UploadRouteContext,
) {
  if (!context.enabled) return notFound();
  const userId = await context.getUserId(request);
  if (!userId) return unauthorized();

  const limited = await context.checkRateLimit("upload", {
    userId,
    ip: getClientIp(request.headers),
  });
  if (!limited.ok) return rateLimitResponse(limited);

  const body = await readJson(request);
  const result = await presignUpload(context.deps(), {
    userId,
    mime: body.mime,
    size: body.size,
  });
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  const { fileId, key, uploadUrl, headers, expiresIn } = result;
  return Response.json({ fileId, key, uploadUrl, headers, expiresIn });
}

/** `POST /api/upload/complete`，body：`{ fileId }`。确认后返回 `{ file }`。 */
export async function handleComplete(
  request: Request,
  context: UploadRouteContext,
) {
  if (!context.enabled) return notFound();
  const userId = await context.getUserId(request);
  if (!userId) return unauthorized();

  const body = await readJson(request);
  const result = await completeUpload(context.deps(), {
    userId,
    fileId: body.fileId,
  });
  return result.ok
    ? Response.json({ file: result.file })
    : Response.json({ error: result.error }, { status: result.status });
}

/** `GET /api/upload/files/<id>`：跳转到文件地址（私有文件是签名地址），可直接用作 `<img src>`。 */
export async function handleFileRedirect(
  request: Request,
  fileId: string,
  context: UploadRouteContext,
) {
  if (!context.enabled) return notFound();
  const userId = await context.getUserId(request);
  if (!userId) return unauthorized();

  const url = await getFileUrl(context.deps(), { userId, fileId });
  if (!url) return notFound();
  return new Response(null, {
    status: 302,
    // 签名地址会过期，不让浏览器和 CDN 缓存这次跳转。
    headers: { Location: url, "Cache-Control": "private, no-store" },
  });
}
