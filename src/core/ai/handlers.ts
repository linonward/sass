import { getClientIp } from "@/core/ratelimit/limiter";

import type { Generation, RunImageInput, RunImageResult } from "./image";
import type { StartVideoInput, VideoService } from "./video";

// 请求体上限：只有提示词和几个选项。
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
    // 下面统一返回 400。
  }
  return {
    error: Response.json({ error: "invalid_request" }, { status: 400 }),
  };
}

/**
 * `POST /api/ai/image`：body 为 `{ prompt, modelId?, aspectRatio? }`，
 * 同步生成一张图，返回 `{ generation }`。错误响应是 JSON `{ error }`。
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
    abortSignal: request.signal,
  });
  if (!run.ok) return run.response;
  return Response.json({ generation: run.generation });
}

/** `GET /api/ai/generations`：当前用户最近的图片、视频生成，返回 `{ generations }`。 */
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
 * `POST /api/ai/video`：body 为 `{ prompt, modelId?, aspectRatio?, imageFileId? }`，
 * 提交异步任务，返回 `{ job: { id, status: "pending" } }`，之后用 GET /api/ai/video/:id 查询。
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

/** `GET /api/ai/video/:id`：查询并推进任务，返回 `{ job }`（pending / failed / succeeded）。 */
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
  return Response.json({ job: result.job });
}
