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

/** Dependencies of the route handlers. Bound by ./routes.ts in production, replaced in tests. */
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

/**
 * Pre-checks shared by the three upload endpoints: feature flag → sign-in → `upload` rate limit.
 * All three must be limited: presign hands out upload URLs, and complete and redirect each hit R2
 * too (HeadObject / signed GET); limiting only one would leave the other two as a free proxy.
 */
async function authorize(
  request: Request,
  context: UploadRouteContext,
): Promise<{ userId: string } | { response: Response }> {
  if (!context.enabled) return { response: notFound() };
  const userId = await context.getUserId(request);
  if (!userId) return { response: unauthorized() };

  const limited = await context.checkRateLimit("upload", {
    userId,
    ip: getClientIp(request.headers),
  });
  if (!limited.ok) return { response: rateLimitResponse(limited) };

  return { userId };
}

async function readJson(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  return body && typeof body === "object"
    ? (body as Record<string, unknown>)
    : {};
}

/**
 * `POST /api/upload/presign`, body: `{ mime, size }`.
 * Requires sign-in and the `upload` rate limit; returns
 * `{ fileId, key, uploadUrl, headers, expiresIn }`.
 */
export async function handlePresign(
  request: Request,
  context: UploadRouteContext,
) {
  const auth = await authorize(request, context);
  if ("response" in auth) return auth.response;

  const body = await readJson(request);
  const result = await presignUpload(context.deps(), {
    userId: auth.userId,
    mime: body.mime,
    size: body.size,
  });
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  const { fileId, key, uploadUrl, headers, expiresIn } = result;
  return Response.json({ fileId, key, uploadUrl, headers, expiresIn });
}

/** `POST /api/upload/complete`, body: `{ fileId }`. Returns `{ file }` once confirmed. */
export async function handleComplete(
  request: Request,
  context: UploadRouteContext,
) {
  const auth = await authorize(request, context);
  if ("response" in auth) return auth.response;

  const body = await readJson(request);
  const result = await completeUpload(context.deps(), {
    userId: auth.userId,
    fileId: body.fileId,
  });
  return result.ok
    ? Response.json({ file: result.file })
    : Response.json({ error: result.error }, { status: result.status });
}

/**
 * `GET /api/upload/files/<id>`: redirects to the file URL (a signed URL for private files); usable
 * directly as `<img src>`.
 */
export async function handleFileRedirect(
  request: Request,
  fileId: string,
  context: UploadRouteContext,
) {
  const auth = await authorize(request, context);
  if ("response" in auth) return auth.response;

  const url = await getFileUrl(context.deps(), {
    userId: auth.userId,
    fileId,
  });
  if (!url) return notFound();
  return new Response(null, {
    status: 302,
    // Signed URLs expire, so browsers and CDNs must not cache this redirect.
    headers: { Location: url, "Cache-Control": "private, no-store" },
  });
}
