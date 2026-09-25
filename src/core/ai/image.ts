import type { ImageModelV4 } from "@ai-sdk/provider";
import { generateImage } from "ai";

import {
  uploadMimeTypes,
  type AiConfig,
  type AiImageModel,
  type UploadMimeType,
} from "@/core/config/schema";
import type { Credits } from "@/core/credits";
import type { Database } from "@/core/db/client";
import { files } from "@/core/db/schema";
import { logger, type LogFn } from "@/core/observability/logger";
import { withSpan } from "@/core/observability/trace";
import type {
  RateLimitIdentifiers,
  RateLimitResult,
} from "@/core/ratelimit/limiter";
import { rateLimitResponse } from "@/core/ratelimit/limiter";
import type { ObjectStorage } from "@/core/upload/storage";
import { buildObjectKey } from "@/core/upload/validate";

import { reserveUsage, settleUsage, type UsageDeps } from "./usage";

/** 前端可选的画幅；服务商不支持的画幅由适配器回退并给出 warning。 */
export const imageAspectRatios = ["1:1", "16:9", "9:16", "4:3", "3:4"] as const;
export type ImageAspectRatio = (typeof imageAspectRatios)[number];

// 提示词上限。按次固定扣费，太长的提示词服务商也会拒绝。
export const MAX_IMAGE_PROMPT_LENGTH = 2000;

export type RunImageInput = {
  userId: string | null | undefined;
  ip?: string | null;
  // site.config.ts 中 ai.imageModels 的 id；不填用 ai.defaultImageModel。
  modelId?: unknown;
  prompt: unknown;
  aspectRatio?: unknown;
  abortSignal?: AbortSignal;
  maxRetries?: number;
};

/** 一次生成的结果，也是生成记录列表里的一项。 */
export type Generation = {
  id: string;
  kind: "image" | "video";
  // files.id，可以作为图生视频的首帧。
  fileId: string;
  modelId: string;
  prompt: string;
  url: string;
  mime: string;
  createdAt: string;
};

export type RunImageResult =
  | { ok: true; generation: Generation }
  | {
      ok: false;
      status: 400 | 401 | 402 | 429 | 502 | 503;
      response: Response;
    };

export type RunImageDeps = {
  db: Database | (() => Database);
  config: AiConfig;
  credits: Pick<Credits, "deductCredits" | "refundCredits">;
  checkRateLimit: (
    policy: string,
    identifiers: RateLimitIdentifiers,
  ) => Promise<RateLimitResult>;
  // 按配置取模型；该服务商没有配置 key 时返回 null。
  getModel: (model: AiImageModel) => ImageModelV4 | null;
  // 没有配置 R2 时返回 null。
  getStorage: () => ObjectStorage | null;
  // 对象的访问地址（公开域名或签名地址），见 upload 模块的 fileUrl。
  fileUrl: (key: string) => Promise<string>;
  now?: () => number;
  logError?: LogFn;
};

function fail(status: 400 | 401 | 402 | 502 | 503, error: string) {
  return {
    ok: false as const,
    status,
    response: Response.json({ error }, { status }),
  };
}

function imageMime(mediaType: string): UploadMimeType {
  return mediaType in uploadMimeTypes && mediaType.startsWith("image/")
    ? (mediaType as UploadMimeType)
    : "image/png";
}

/**
 * 创建 runImage。默认实例见 `./index.ts`；测试注入 mock 模型、数据库、存储和限流。
 *
 * 顺序：检查登录 → 校验提示词和模型 → 检查存储 → 限流（ai 策略）→ 预扣积分并写 ai_usage
 * → generateImage → 写入 R2 和 files。生成或存储失败时退回积分。
 */
export function createRunImage({
  db,
  config,
  credits,
  checkRateLimit,
  getModel,
  getStorage,
  fileUrl,
  now = Date.now,
  logError = logger.error,
}: RunImageDeps) {
  const getDb = () => (typeof db === "function" ? db() : db);
  const usageDeps: UsageDeps = { db: getDb, credits, logError };

  // 整个调用放在一个 span 里，结束时由 settleUsage 补充模型、积分和结果。
  return function runImage(input: RunImageInput): Promise<RunImageResult> {
    return withSpan("ai.image", {}, () => generate(input));
  };

  async function generate(input: RunImageInput): Promise<RunImageResult> {
    const { userId, ip, abortSignal, maxRetries } = input;
    if (!userId) return fail(401, "unauthorized");

    const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
    if (!prompt || prompt.length > MAX_IMAGE_PROMPT_LENGTH) {
      return fail(400, "invalid_prompt");
    }
    const aspectRatio = input.aspectRatio ?? "1:1";
    if (!imageAspectRatios.includes(aspectRatio as ImageAspectRatio)) {
      return fail(400, "invalid_aspect_ratio");
    }
    const modelId = input.modelId ?? config.defaultImageModel;
    const model = config.imageModels.find((m) => m.id === modelId);
    if (!model) return fail(400, "invalid_model");
    const imageModel = getModel(model);
    if (!imageModel) return fail(503, "model_unavailable");
    const storage = getStorage();
    if (!storage) return fail(503, "storage_unavailable");

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
      kind: "image",
      model,
      prompt,
    });
    if (!usageId) return fail(402, "insufficient_credits");

    const startedAt = now();
    try {
      const { image } = await generateImage({
        model: imageModel,
        prompt,
        aspectRatio: aspectRatio as ImageAspectRatio,
        n: 1,
        abortSignal,
        maxRetries,
      });
      const mime = imageMime(image.mediaType);
      const key = buildObjectKey({ userId, mime });
      await storage.putObject({ key, mime, body: image.uint8Array });
      const [file] = await getDb()
        .insert(files)
        .values({
          userId,
          key,
          size: image.uint8Array.byteLength,
          mime,
          status: "uploaded",
        })
        .returning({ id: files.id, createdAt: files.createdAt });
      await settleUsage(usageDeps, {
        userId,
        usageId,
        model,
        status: "succeeded",
        durationMs: now() - startedAt,
        fileId: file!.id,
      });
      return {
        ok: true,
        generation: {
          id: usageId,
          kind: "image",
          fileId: file!.id,
          modelId: model.id,
          prompt,
          url: await fileUrl(key),
          mime,
          createdAt: file!.createdAt.toISOString(),
        },
      };
    } catch (error) {
      logError("ai.model_failed", { error, kind: "image", modelId: model.id });
      await settleUsage(usageDeps, {
        userId,
        usageId,
        model,
        status: "failed",
        durationMs: now() - startedAt,
        error,
      });
      return fail(502, "model_error");
    }
  }
}

export type RunImage = ReturnType<typeof createRunImage>;
