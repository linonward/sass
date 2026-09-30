import { and, eq } from "drizzle-orm";

import type { AiConfig, AiVideoModel } from "@/core/config/schema";
import type { Credits } from "@/core/credits";
import type { Database } from "@/core/db/client";
import { aiUsage, files } from "@/core/db/schema";
import { openException } from "@/core/exceptions/open";
import { logger, type LogFn } from "@/core/observability/logger";
import { withSpan } from "@/core/observability/trace";
import type {
  RateLimitIdentifiers,
  RateLimitResult,
} from "@/core/ratelimit/limiter";
import { rateLimitResponse } from "@/core/ratelimit/limiter";
import type { ObjectStorage } from "@/core/upload/storage";
import { buildObjectKey } from "@/core/upload/validate";

import type { VideoClient, VideoTaskStatus } from "./alibaba-video";
import { MAX_IMAGE_PROMPT_LENGTH, type Generation } from "./image";
import { createOwnedImageUrl } from "./owned-image";
import { logUsage, reserveUsage, settleUsage, type UsageDeps } from "./usage";

/** Source of AI job exceptions on the exceptions page: source_id is ai_usage.id. */
export const AI_EXCEPTION_SOURCE = "ai_usage";

/** Aspect ratios available for text-to-video; image-to-video follows the first frame. */
export const videoAspectRatios = ["16:9", "9:16", "1:1", "4:3", "3:4"] as const;

/**
 * If the provider still says "still generating" this long after submission (or there is no job to
 * query at all), the job is treated as failed and refunded. Jobs are advanced two ways: frontend
 * polling (`pollVideo`) and the recovery sweep (`recoverVideo`, see ./recovery.ts) — the latter is
 * the fallback once the user closes the page.
 */
export const VIDEO_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Hard limit for "no conclusion yet": the provider status can't be fetched, or the provider has a
 * result but copying it to local storage failed / storage isn't configured. A timeout is not a
 * failure — in these cases the video may already be generated, and refunding at 30 minutes would
 * throw the result away. The provider's video URL expires after 24 hours; only past that point is
 * the result truly unrecoverable, so only then is it refunded as failed.
 */
export const VIDEO_RESULT_TTL_MS = 24 * 60 * 60 * 1000;

export type StartVideoInput = {
  userId: string | null | undefined;
  ip?: string | null;
  modelId?: unknown;
  prompt: unknown;
  aspectRatio?: unknown;
  // First frame for image-to-video: one of the user's own image files (uploaded, or an image
  // generation result).
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
  // Resolves the video client from config; returns null when that provider has no key configured.
  getClient: (model: AiVideoModel) => VideoClient | null;
  getStorage: () => ObjectStorage | null;
  fileUrl: (key: string) => Promise<string>;
  // Downloads the video returned by the provider.
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
 * Creates the video service. The default instance is in `./index.ts`; tests inject a mock client,
 * database, storage, and rate limiting.
 *
 * - startVideo: sign-in → validation → check storage → rate limit (ai policy) → pre-deduct credits
 *   and write ai_usage → submit the job and record the taskId. Refunds if submission fails.
 * - pollVideo: queries the job. On completion, downloads the video into R2 and writes files;
 *   refunds on failure or timeout. When several requests query at once, only one settles.
 * - recoverVideo: for the recovery sweep; advances one job by id (without checking the user),
 *   taking the same settlement path as pollVideo.
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

  const ownImageUrl = createOwnedImageUrl(getDb, fileUrl);

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
   * Deletes an object no row in the files table references. When the copy fails or collides with a
   * concurrent settlement, the object may already be in storage while its row never landed (rolled
   * back, or deleted because of the race) — left alone it becomes a permanent orphan. Best effort:
   * failures are only logged and don't affect this query's result.
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
    return advance(row.usage, row.file);
  }

  /** Recovery sweep: advances one video job by id. Returns null when the job doesn't exist. */
  async function recoverVideo(id: string): Promise<VideoJob | null> {
    const [row] = await getDb()
      .select({ usage: aiUsage, file: files })
      .from(aiUsage)
      .leftJoin(files, eq(files.id, aiUsage.fileId))
      .where(and(eq(aiUsage.id, id), eq(aiUsage.kind, "video")));
    if (!row) return null;
    return (await advance(row.usage, row.file)).job;
  }

  /**
   * "Recheck provider" on the exceptions page: only asks the provider for the job's current status,
   * without changing anything. Returns null when there is no taskId or the model is unavailable.
   */
  async function providerStatus(id: string): Promise<VideoTaskStatus | null> {
    const [usage] = await getDb()
      .select()
      .from(aiUsage)
      .where(and(eq(aiUsage.id, id), eq(aiUsage.kind, "video")));
    const taskId = usage?.operation?.taskId;
    const configured = config.videoModels.find((m) => m.id === usage?.modelId);
    const client = configured ? getClient(configured) : null;
    if (!taskId || !client) return null;
    return client.status(taskId);
  }

  /**
   * Advances one job: finished jobs return as is; pending ones ask the provider first, then copy to
   * storage, settle, or keep waiting based on the result. pollVideo and recoverVideo share this
   * path; under concurrency `onlyIfPending` and the claim below ensure a single settlement.
   */
  async function advance(
    usage: typeof aiUsage.$inferSelect,
    file: typeof files.$inferSelect | null,
  ): Promise<{ ok: true; job: VideoJob }> {
    const { id, userId } = usage;
    if (usage.status === "succeeded" && file) {
      return { ok: true, job: await succeededJob(usage, file) };
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
    // createdAt is parsed as UTC by drizzle's column mapping (the client ensures the session time
    // zone is UTC too; see core/db/client.ts).
    const elapsed = now() - usage.createdAt.getTime();
    // Jobs that need a human: open (or update) an exception. detail carries the context needed to
    // reconcile it.
    const reviewDetail = (reason: string) => ({
      usageId: id,
      taskId: usage.operation?.taskId ?? null,
      modelId: usage.modelId,
      credits: usage.credits,
      reason,
    });
    /**
     * `review`: this refund isn't because the provider explicitly reported failure but because we
     * waited too long without a conclusion — the provider may actually have succeeded. Opens an
     * `ai_job_needs_review` in the same transaction as the refund so a human can decide whether to
     * claw back the refund or deliver the video.
     */
    const settleFailed = async (
      error: unknown,
      { review = false }: { review?: boolean } = {},
    ) => {
      await settleUsage(usageDeps, {
        userId,
        usageId: id,
        // Refund the credits pre-deducted at submission, unaffected by later config changes.
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
        inSettlement: review
          ? (tx) =>
              openException(tx, {
                kind: "ai_job_needs_review",
                userId,
                source: AI_EXCEPTION_SOURCE,
                sourceId: id,
                detail: {
                  ...reviewDetail(
                    error instanceof Error ? error.message : String(error),
                  ),
                  refunded: true,
                },
                bump: true,
              })
          : undefined,
      });
      return failed;
    };

    // Two limits: when the provider explicitly says "not ready yet" (or there is no job to query),
    // use VIDEO_TIMEOUT_MS; when no conclusion can be reached (the query errors, or there is a
    // result that can't be stored), use VIDEO_RESULT_TTL_MS — a timeout is not a failure.
    const waitOr = (limitMs: number, reason: unknown) =>
      elapsed > limitMs ? settleFailed(reason, { review: true }) : pending;

    const configured = config.videoModels.find((m) => m.id === usage.modelId);
    const client = configured ? getClient(configured) : null;
    const taskId = usage.operation?.taskId;
    if (!taskId) {
      // The process died during submission before recording taskId: there is no provider job to
      // reconcile by id.
      return waitOr(
        VIDEO_TIMEOUT_MS,
        "timeout: no provider task id recorded (submission was interrupted)",
      );
    }
    if (!client) {
      // The model was retired or its key removed: there is no way to ask the provider.
      return waitOr(
        VIDEO_TIMEOUT_MS,
        "timeout: video model unavailable, provider task could not be checked",
      );
    }

    let status;
    try {
      status = await client.status(taskId);
    } catch (error) {
      // A failed query is treated as transient; query again next time.
      logError("ai.video_status_failed", { error, taskId });
      // Past the normal time to a result and the status still can't be fetched: it can be judged
      // neither success nor failure, so open an exception for a human to see. Repeated failures on
      // the same exception only bump its count; failing to open it doesn't affect this query.
      if (elapsed > VIDEO_TIMEOUT_MS) {
        try {
          await openException(getDb(), {
            kind: "ai_job_needs_review",
            userId,
            source: AI_EXCEPTION_SOURCE,
            sourceId: id,
            detail: reviewDetail("provider task status unavailable"),
            lastError: (error instanceof Error
              ? error.message
              : String(error)
            ).slice(0, 1000),
            bump: true,
          });
        } catch (openError) {
          logError("ai.exception_open_failed", {
            error: openError,
            usageId: id,
          });
        }
      }
      return waitOr(
        VIDEO_RESULT_TTL_MS,
        "timeout: provider task status unavailable for 24 hours",
      );
    }
    if (status.status === "failed") return settleFailed(status.error);
    if (status.status === "pending") {
      return waitOr(
        VIDEO_TIMEOUT_MS,
        "timeout: provider returned no result within 30 minutes",
      );
    }

    // Only the copy needs storage; if it isn't configured, wait until it is (failed jobs were
    // already refunded above).
    const storage = getStorage();
    if (!storage) return waitOr(VIDEO_RESULT_TTL_MS, "storage_unavailable");
    // The key is derived from ai_usage.id: concurrent queries write the same object, and files
    // dedupes by key.
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
        // `.returning()` tells whether this call inserted the row: race cleanup may only delete
        // rows it created itself.
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

        // Race: another concurrent query (the user has two tabs open, or keeps hitting refresh)
        // already settled this usage. We must finish with the settled status and never return
        // "success + video URL" — otherwise the user gets both the video and the refund.
        const [current] = await tx
          .select({ status: aiUsage.status, fileId: aiUsage.fileId })
          .from(aiUsage)
          .where(eq(aiUsage.id, id));
        if (current?.status === "succeeded" && current.fileId) {
          // The winner also did a copy (same key, so only one row exists): return the winner's file
          // and leave it alone.
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
        // Already settled as failed (refunded): the record from this copy must not remain.
        if (created) await tx.delete(files).where(eq(files.key, key));
        return { file: saved, created, claimed: false };
      });
      if (!outcome.claimed) {
        logError("ai.video_settled_elsewhere", {
          usageId: id,
          created: outcome.created,
        });
        // No row references the object written here anymore; delete it best effort to avoid an
        // orphan.
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
      // The provider has a result; we just can't store it locally. The video URL only expires after
      // 24 hours, so until then treat this as transient and retry without refunding (refunding and
      // then storing successfully would give the user both the video and the refund, and the result
      // is still retrievable).
      logError("ai.video_store_failed", { error, usageId: id });
      if (stored) await removeOrphanObject(storage, key);
      return waitOr(VIDEO_RESULT_TTL_MS, error);
    }
  }

  return {
    startVideo: (input: StartVideoInput) =>
      withSpan("ai.video.start", {}, () => startVideo(input)),
    pollVideo: (input: Parameters<typeof pollVideo>[0]) =>
      withSpan("ai.video.poll", {}, () => pollVideo(input)),
    recoverVideo: (id: string) =>
      withSpan("ai.video.recover", {}, () => recoverVideo(id)),
    providerStatus: (id: string) =>
      withSpan("ai.video.provider_status", {}, () => providerStatus(id)),
  };
}

export type VideoService = ReturnType<typeof createVideoService>;
