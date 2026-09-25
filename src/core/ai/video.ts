import { and, eq } from "drizzle-orm";

import type { AiConfig, AiVideoModel } from "@/core/config/schema";
import type { Credits } from "@/core/credits";
import type { Database } from "@/core/db/client";
import { aiUsage, files } from "@/core/db/schema";
import type {
  RateLimitIdentifiers,
  RateLimitResult,
} from "@/core/ratelimit/limiter";
import { rateLimitResponse } from "@/core/ratelimit/limiter";
import type { ObjectStorage } from "@/core/upload/storage";
import { buildObjectKey } from "@/core/upload/validate";

import type { VideoClient } from "./alibaba-video";
import { MAX_IMAGE_PROMPT_LENGTH, type Generation } from "./image";
import { reserveUsage, settleUsage, type UsageDeps } from "./usage";

/** 文生视频可选的画幅；图生视频跟随首帧。 */
export const videoAspectRatios = ["16:9", "9:16", "1:1", "4:3", "3:4"] as const;

/**
 * 任务提交后超过这个时长还没完成，按失败处理并退款。
 * 没有后台任务扫描，只在查询时推进：用户离开后再回来查询时才会结算。
 */
export const VIDEO_TIMEOUT_MS = 30 * 60 * 1000;

export type StartVideoInput = {
  userId: string | null | undefined;
  ip?: string | null;
  modelId?: unknown;
  prompt: unknown;
  aspectRatio?: unknown;
  // 图生视频的首帧：用户自己的图片文件（上传的，或图片生成的结果）。
  imageFileId?: unknown;
};

type Fail = {
  ok: false;
  status: 400 | 401 | 402 | 404 | 429 | 502 | 503;
  response: Response;
};

export type VideoJob =
  | { id: string; status: "pending" }
  | { id: string; status: "failed" }
  | { id: string; status: "succeeded"; generation: Generation };

export type VideoDeps = {
  db: Database | (() => Database);
  config: AiConfig;
  credits: Pick<Credits, "deductCredits" | "refundCredits">;
  checkRateLimit: (
    policy: string,
    identifiers: RateLimitIdentifiers,
  ) => Promise<RateLimitResult>;
  // 按配置取视频客户端；该服务商没有配置 key 时返回 null。
  getClient: (model: AiVideoModel) => VideoClient | null;
  getStorage: () => ObjectStorage | null;
  fileUrl: (key: string) => Promise<string>;
  // 下载服务商返回的视频。
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  logError?: (message: string, error: unknown) => void;
};

function fail(status: Fail["status"], error: string): Fail {
  return {
    ok: false,
    status,
    response: Response.json({ error }, { status }),
  };
}

/**
 * 创建视频服务。默认实例见 `./index.ts`；测试注入 mock 客户端、数据库、存储和限流。
 *
 * - startVideo：登录 → 校验 → 检查存储 → 限流（ai 策略）→ 预扣积分并写 ai_usage → 提交任务，
 *   记下 taskId。提交失败退款。
 * - pollVideo：查询任务。完成后下载视频存进 R2、写 files；失败或超时退款。
 *   多个请求同时查询时，只有一个会结算。
 */
export function createVideoService({
  db,
  config,
  credits,
  checkRateLimit,
  getClient,
  getStorage,
  fileUrl,
  fetch = globalThis.fetch,
  now = Date.now,
  logError = console.error,
}: VideoDeps) {
  const getDb = () => (typeof db === "function" ? db() : db);
  const usageDeps: UsageDeps = { db: getDb, credits, logError };

  async function ownImageUrl(userId: string, fileId: unknown) {
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
  }

  async function startVideo(
    input: StartVideoInput,
  ): Promise<{ ok: true; job: VideoJob } | Fail> {
    const { userId, ip } = input;
    if (!userId) return fail(401, "unauthorized");

    const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
    if (!prompt || prompt.length > MAX_IMAGE_PROMPT_LENGTH) {
      return fail(400, "invalid_prompt");
    }
    const modelId = input.modelId ?? config.defaultVideoModel;
    const model = config.videoModels.find((m) => m.id === modelId);
    if (!model) return fail(400, "invalid_model");
    const aspectRatio = input.aspectRatio ?? "16:9";
    if (
      model.input === "text" &&
      !videoAspectRatios.includes(aspectRatio as never)
    ) {
      return fail(400, "invalid_aspect_ratio");
    }
    const client = getClient(model);
    if (!client) return fail(503, "model_unavailable");
    if (!getStorage()) return fail(503, "storage_unavailable");
    let firstFrameUrl: string | undefined;
    if (model.input === "image") {
      firstFrameUrl =
        (await ownImageUrl(userId, input.imageFileId)) ?? undefined;
      if (!firstFrameUrl) return fail(400, "invalid_image");
    }

    const limit = await checkRateLimit("ai", { userId, ip });
    if (!limit.ok) {
      return {
        ok: false,
        status: limit.reason === "limited" ? 429 : 503,
        response: rateLimitResponse(limit),
      };
    }

    const usageId = await reserveUsage(usageDeps, {
      userId,
      kind: "video",
      model,
      prompt,
    });
    if (!usageId) return fail(402, "insufficient_credits");

    const startedAt = now();
    try {
      const { taskId } = await client.start({
        model: model.model,
        prompt,
        firstFrameUrl,
        duration: model.duration,
        resolution: model.resolution,
        ratio: model.input === "text" ? String(aspectRatio) : undefined,
      });
      await getDb()
        .update(aiUsage)
        .set({ operation: { taskId } })
        .where(eq(aiUsage.id, usageId));
      return { ok: true, job: { id: usageId, status: "pending" } };
    } catch (error) {
      logError(`[ai] video model ${model.id} failed to start`, error);
      await settleUsage(usageDeps, {
        userId,
        usageId,
        model,
        status: "failed",
        durationMs: now() - startedAt,
        error,
        onlyIfPending: true,
      });
      return fail(502, "model_error");
    }
  }

  async function succeededJob(
    usage: { id: string; modelId: string; prompt: string | null },
    file: { id: string; key: string; mime: string; createdAt: Date },
  ): Promise<VideoJob> {
    return {
      id: usage.id,
      status: "succeeded",
      generation: {
        id: usage.id,
        kind: "video",
        fileId: file.id,
        modelId: usage.modelId,
        prompt: usage.prompt ?? "",
        url: await fileUrl(file.key),
        mime: file.mime,
        createdAt: file.createdAt.toISOString(),
      },
    };
  }

  async function pollVideo({
    userId,
    id,
  }: {
    userId: string | null | undefined;
    id: unknown;
  }): Promise<{ ok: true; job: VideoJob } | Fail> {
    if (!userId) return fail(401, "unauthorized");
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) {
      return fail(404, "not_found");
    }
    const [row] = await getDb()
      .select({ usage: aiUsage, file: files })
      .from(aiUsage)
      .leftJoin(files, eq(files.id, aiUsage.fileId))
      .where(
        and(
          eq(aiUsage.id, id),
          eq(aiUsage.userId, userId),
          eq(aiUsage.kind, "video"),
        ),
      );
    if (!row) return fail(404, "not_found");
    const { usage } = row;
    if (usage.status === "succeeded" && row.file) {
      return { ok: true, job: await succeededJob(usage, row.file) };
    }
    if (usage.status !== "pending") {
      return { ok: true, job: { id, status: "failed" } };
    }

    const pending = {
      ok: true as const,
      job: { id, status: "pending" as const },
    };
    const failed = {
      ok: true as const,
      job: { id, status: "failed" as const },
    };
    const elapsed = now() - usage.createdAt.getTime();
    const settleFailed = async (error: unknown) => {
      await settleUsage(usageDeps, {
        userId,
        usageId: id,
        // 按提交时预扣的积分退，不受之后改配置影响。
        model: {
          id: usage.modelId,
          provider: usage.provider,
          model: usage.model,
          creditCost: usage.credits,
        },
        status: "failed",
        durationMs: elapsed,
        error,
        onlyIfPending: true,
      });
      return failed;
    };

    const configured = config.videoModels.find((m) => m.id === usage.modelId);
    const client = configured ? getClient(configured) : null;
    const taskId = usage.operation?.taskId;
    if (!client || !taskId) {
      // 模型下线、key 被移除，或提交时进程中断没记下 taskId：超时后退款。
      return elapsed > VIDEO_TIMEOUT_MS ? settleFailed("timeout") : pending;
    }

    let status;
    try {
      status = await client.status(taskId);
    } catch (error) {
      // 查询失败按暂时性错误处理，下次再查。
      logError(`[ai] video task ${taskId} status failed`, error);
      return elapsed > VIDEO_TIMEOUT_MS ? settleFailed("timeout") : pending;
    }
    if (status.status === "failed") return settleFailed(status.error);
    if (status.status === "pending") {
      return elapsed > VIDEO_TIMEOUT_MS ? settleFailed("timeout") : pending;
    }

    // 只有转存需要存储；没配置时等配好或超时，失败的任务上面已经退款。
    const storage = getStorage();
    if (!storage) {
      return elapsed > VIDEO_TIMEOUT_MS
        ? settleFailed("storage_unavailable")
        : pending;
    }
    try {
      const response = await fetch(status.videoUrl);
      if (!response.ok) {
        throw new Error(`Failed to download video (${response.status})`);
      }
      const body = new Uint8Array(await response.arrayBuffer());
      // key 由 ai_usage.id 决定：并发查询写的是同一个对象，files 按 key 去重。
      const key = buildObjectKey({
        userId,
        mime: "video/mp4",
        id,
        now: usage.createdAt,
      });
      await storage.putObject({ key, mime: "video/mp4", body });
      const file = await getDb().transaction(async (tx) => {
        await tx
          .insert(files)
          .values({
            userId,
            key,
            size: body.byteLength,
            mime: "video/mp4",
            status: "uploaded",
          })
          .onConflictDoNothing({ target: files.key });
        const [saved] = await tx.select().from(files).where(eq(files.key, key));
        await tx
          .update(aiUsage)
          .set({
            status: "succeeded",
            fileId: saved!.id,
            durationMs: Math.max(0, Math.round(elapsed)),
            finishedAt: new Date(),
          })
          .where(and(eq(aiUsage.id, id), eq(aiUsage.status, "pending")));
        return saved!;
      });
      return { ok: true, job: await succeededJob(usage, file) };
    } catch (error) {
      // 服务商的视频地址 24 小时后失效；超时之前都当作暂时性错误重试。
      logError(`[ai] failed to store video ${id}`, error);
      return elapsed > VIDEO_TIMEOUT_MS ? settleFailed(error) : pending;
    }
  }

  return { startVideo, pollVideo };
}

export type VideoService = ReturnType<typeof createVideoService>;
