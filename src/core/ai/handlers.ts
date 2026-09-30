import { getClientIp } from "@/core/ratelimit/limiter";

import type { Generation, RunImageInput, RunImageResult } from "./image";
import type { StartVideoInput, VideoService } from "./video";

// Request body limit: it only holds the prompt and a few options.
export const MAX_IMAGE_BODY_BYTES = 16 * 1024;

type BaseDeps = {
  enabled: boolean;
  getUserId: (request: Request) => Promise<string | null>;
};

async function readJson(request: Request, maxBytes: number) {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    return { error: Response.json({ error: "too_large" }, { status: 413 }) };
  }
  try {
    const body: unknown = JSON.parse(text);
    if (body && typeof body === "object") {
      return { body: body as Record<string, unknown> };
    }
  } catch {
    // Falls through to the 400 below.
  }
  return {
    error: Response.json({ error: "invalid_request" }, { status: 400 }),
  };
}

/**
 * `POST /api/ai/image`: the body is `{ prompt, modelId?, aspectRatio?, imageFileId? }`
 * (`imageFileId` is a reference image, for models with `acceptsImage`). Generates one image
 * synchronously and returns `{ generation }`. Error responses are JSON `{ error }`.
 */
export async function handleImage(
  request: Request,
  {
    enabled,
    getUserId,
    runImage,
  }: BaseDeps & { runImage: (input: RunImageInput) => Promise<RunImageResult> },
): Promise<Response> {
  if (!enabled) return Response.json({ error: "not_found" }, { status: 404 });
  const userId = await getUserId(request);
  if (!userId) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const { body, error } = await readJson(request, MAX_IMAGE_BODY_BYTES);
  if (error) return error;

  const run = await runImage({
    userId,
    ip: getClientIp(request.headers),
    prompt: body.prompt,
    modelId: body.modelId,
    aspectRatio: body.aspectRatio,
    imageFileId: body.imageFileId,
    abortSignal: request.signal,
  });
  if (!run.ok) return run.response;
  return Response.json({ generation: run.generation });
}

/**
 * `GET /api/ai/generations`: the current user's recent image and video generations, returned as `{
 * generations }`.
 */
export async function handleGenerations(
  request: Request,
  {
    enabled,
    getUserId,
    listGenerations,
    listPendingVideos = async () => [],
  }: BaseDeps & {
    listGenerations: (userId: string) => Promise<Generation[]>;
    listPendingVideos?: (userId: string) => Promise<unknown[]>;
  },
): Promise<Response> {
  if (!enabled) return Response.json({ error: "not_found" }, { status: 404 });
  const userId = await getUserId(request);
  if (!userId) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const [generations, pendingVideos] = await Promise.all([
    listGenerations(userId),
    listPendingVideos(userId),
  ]);
  return Response.json({ generations, pendingVideos });
}

/**
 * `POST /api/ai/video`: the body is `{ prompt, modelId?, aspectRatio?, imageFileId? }`. Submits an
 * async job and returns `{ job: { id, status: "pending" } }`; poll it afterwards with
 * GET /api/ai/video/:id.
 */
export async function handleVideoStart(
  request: Request,
  {
    enabled,
    getUserId,
    startVideo,
  }: BaseDeps & {
    startVideo: (
      input: StartVideoInput,
    ) => ReturnType<VideoService["startVideo"]>;
  },
): Promise<Response> {
  if (!enabled) return Response.json({ error: "not_found" }, { status: 404 });
  const userId = await getUserId(request);
  if (!userId) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const { body, error } = await readJson(request, MAX_IMAGE_BODY_BYTES);
  if (error) return error;
  const result = await startVideo({
    userId,
    ip: getClientIp(request.headers),
    prompt: body.prompt,
    modelId: body.modelId,
    aspectRatio: body.aspectRatio,
    imageFileId: body.imageFileId,
  });
  if (!result.ok) return result.response;
  return Response.json({ job: result.job }, { status: 202 });
}

/**
 * `GET /api/ai/video/:id`: queries and advances the job, returning `{ job }` (pending / failed /
 * succeeded). Every call may change server state (copying to storage, settling, refunding) and the
 * response is per user, so it must not be cached (same as `/api/billing/status`).
 */
export async function handleVideoStatus(
  request: Request,
  id: string,
  {
    enabled,
    getUserId,
    pollVideo,
  }: BaseDeps & { pollVideo: VideoService["pollVideo"] },
): Promise<Response> {
  if (!enabled) return Response.json({ error: "not_found" }, { status: 404 });
  const userId = await getUserId(request);
  if (!userId) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await pollVideo({ userId, id });
  if (!result.ok) return result.response;
  return Response.json(
    { job: result.job },
    { headers: { "cache-control": "no-store" } },
  );
}
