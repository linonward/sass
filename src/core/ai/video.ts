import { and, eq } from "drizzle-orm";

import type { AiConfig, AiVideoModel } from "@/core/config/schema";
import type { Credits } from "@/core/credits";
import type { Database } from "@/core/db/client";
import { aiUsage, files } from "@/core/db/schema";
import { logger, type LogFn } from "@/core/observability/logger";
import { withSpan } from "@/core/observability/trace";
import type {
  RateLimitIdentifiers,
  RateLimitResult,
} from "@/core/ratelimit/limiter";
import { rateLimitResponse } from "@/core/ratelimit/limiter";
import type { ObjectStorage } from "@/core/upload/storage";
import { buildObjectKey } from "@/core/upload/validate";

import type { VideoClient } from "./alibaba-video";
import { MAX_IMAGE_PROMPT_LENGTH, type Generation } from "./image";
import { logUsage, reserveUsage, settleUsage, type UsageDeps } from "./usage";

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
  logError?: LogFn;
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
  logError = logger.error,
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
      logError("ai.model_failed", { error, kind: "video", modelId: model.id });
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

  /**
   * 删掉 files 表里没人引用的对象。转存失败或撞上并发结算时，对象可能已经写进存储，
   * 但对应的行没落成（回滚了、或按竞态删掉了）—— 不删就是永久的孤儿对象。
   * 尽量做，失败只记日志，不影响本次查询的结果。
   */
  async function removeOrphanObject(storage: ObjectStorage, key: string) {
    try {
      const [row] = await getDb()
        .select({ id: files.id })
        .from(files)
        .where(eq(files.key, key));
      if (!row) await storage.delete(key);
    } catch (error) {
      logError("ai.video_cleanup_failed", { error, key });
    }
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
    // createdAt 由 drizzle 的列映射按 UTC 解析（客户端保证会话时区也是 UTC，见 core/db/client.ts）。
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
      logError("ai.video_status_failed", { error, taskId });
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
    // key 由 ai_usage.id 决定：并发查询写的是同一个对象，files 按 key 去重。
    const key = buildObjectKey({
      userId,
      mime: "video/mp4",
      id,
      now: usage.createdAt,
    });
    let stored = false;
    try {
      const response = await fetch(status.videoUrl);
      if (!response.ok) {
        throw new Error(`Failed to download video (${response.status})`);
      }
      const body = new Uint8Array(await response.arrayBuffer());
      await storage.putObject({ key, mime: "video/mp4", body });
      stored = true;
      const outcome = await getDb().transaction(async (tx) => {
        // `.returning()` 用来分辨「这一行是不是本次插进去的」：竞态清理只能删自己建的行。
        const inserted = await tx
          .insert(files)
          .values({
            userId,
            key,
            size: body.byteLength,
            mime: "video/mp4",
            status: "uploaded",
          })
          .onConflictDoNothing({ target: files.key })
          .returning();
        const created = inserted.length > 0;
        const rows = created
          ? inserted
          : await tx.select().from(files).where(eq(files.key, key));
        const saved = rows[0]!;
        const claimed = await tx
          .update(aiUsage)
          .set({
            status: "succeeded",
            fileId: saved.id,
            durationMs: Math.max(0, Math.round(elapsed)),
            finishedAt: new Date(),
          })
          .where(and(eq(aiUsage.id, id), eq(aiUsage.status, "pending")))
          .returning({ id: aiUsage.id });
        if (claimed.length > 0) return { file: saved, created, claimed: true };

        // 竞态：另一个并发查询（用户开两个标签页、连点刷新）已经把这条 usage 结算掉了。
        // 这里必须按已定状态收场，不能还回「成功 + 视频地址」—— 否则用户视频和退款双拿。
        const [current] = await tx
          .select({ status: aiUsage.status, fileId: aiUsage.fileId })
          .from(aiUsage)
          .where(eq(aiUsage.id, id));
        if (current?.status === "succeeded" && current.fileId) {
          // 赢家也是一次转存（key 相同，只会有一行）：交回赢家的文件，别动它。
          const [winner] = await tx
            .select()
            .from(files)
            .where(eq(files.id, current.fileId));
          if (winner) {
            if (created && winner.id !== saved.id) {
              await tx.delete(files).where(eq(files.key, key));
            }
            return { file: winner, created, claimed: true };
          }
        }
        // 已按失败结算（款已退）：这次转存的记录不能留下。
        if (created) await tx.delete(files).where(eq(files.key, key));
        return { file: saved, created, claimed: false };
      });
      if (!outcome.claimed) {
        logError("ai.video_settled_elsewhere", {
          usageId: id,
          created: outcome.created,
        });
        // 本次写的对象已经没有行引用了，尽力删掉，避免孤儿。
        if (outcome.created) await removeOrphanObject(storage, key);
        return failed;
      }
      logUsage({
        usageId: id,
        userId,
        model: {
          id: usage.modelId,
          provider: usage.provider,
          model: usage.model,
          creditCost: usage.credits,
        },
        status: "succeeded",
        durationMs: elapsed,
      });
      return { ok: true, job: await succeededJob(usage, outcome.file) };
    } catch (error) {
      // 服务商的视频地址 24 小时后失效；超时之前都当作暂时性错误重试。
      logError("ai.video_store_failed", { error, usageId: id });
      if (stored) await removeOrphanObject(storage, key);
      return elapsed > VIDEO_TIMEOUT_MS ? settleFailed(error) : pending;
    }
  }

  return {
    startVideo: (input: StartVideoInput) =>
      withSpan("ai.video.start", {}, () => startVideo(input)),
    pollVideo: (input: Parameters<typeof pollVideo>[0]) =>
      withSpan("ai.video.poll", {}, () => pollVideo(input)),
  };
}

export type VideoService = ReturnType<typeof createVideoService>;
