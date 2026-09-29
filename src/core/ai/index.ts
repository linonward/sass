import { deductCredits, refundCredits } from "@/core/credits";
import { getDb } from "@/core/db";
import { env } from "@/core/env";
import { checkRateLimit } from "@/core/ratelimit";
import { fileUrl, getUploadStorage, uploadEnabled } from "@/core/upload";

import siteConfig from "../../../site.config";
import {
  listGenerations as listGenerationsFor,
  listPendingVideos as listPendingVideosFor,
} from "./generations";
import { createRunImage } from "./image";
import { createAiRecovery } from "./recovery";
import {
  createImageModelResolver,
  createModelResolver,
  createVideoClientResolver,
} from "./registry";
import { createVideoService } from "./video";
import { createRunAI } from "./run";

export { AI_CREDIT_SOURCE, type RunAIInput, type RunAIResult } from "./run";
export { imageAspectRatios, type Generation } from "./image";
export { videoAspectRatios, type VideoJob } from "./video";

/** Whether `features.ai` is on. When off, AI routes return 404 and the sidebar hides Playground. */
export const aiEnabled = siteConfig.features.ai;

/** Selectable models (shown in the frontend): only the id and credit cost. */
export const aiModels = siteConfig.ai.models.map(({ id, creditCost }) => ({
  id,
  creditCost,
}));

export const defaultAiModel = siteConfig.ai.defaultModel;

/** runAI bound to the global database, credits, rate limiting, and provider keys from env. */
export const runAI = createRunAI({
  db: getDb,
  config: siteConfig.ai,
  credits: { deductCredits, refundCredits },
  checkRateLimit,
  getModel: createModelResolver(env),
});

/**
 * Whether image generation is available: AI and uploads are on (results are stored in R2) and image
 * models are configured.
 */
export const aiImageEnabled =
  aiEnabled && uploadEnabled && siteConfig.ai.imageModels.length > 0;

export const aiImageModels = siteConfig.ai.imageModels.map(
  ({ id, creditCost }) => ({ id, creditCost }),
);

export const defaultAiImageModel = siteConfig.ai.defaultImageModel;

const storedFileUrl = (key: string) =>
  fileUrl(
    {
      storage: getUploadStorage(),
      config: siteConfig.upload,
      publicUrl: env.R2_PUBLIC_URL,
    },
    key,
  );

/**
 * runImage bound to the global database, credits, rate limiting, R2, and provider keys from env.
 */
export const runImage = createRunImage({
  db: getDb,
  config: siteConfig.ai,
  credits: { deductCredits, refundCredits },
  checkRateLimit,
  getModel: createImageModelResolver(env),
  getStorage: getUploadStorage,
  fileUrl: storedFileUrl,
});

/** The current user's recent image and video generations. */
export function listGenerations(userId: string) {
  return listGenerationsFor(
    { db: getDb(), fileUrl: storedFileUrl },
    { userId },
  );
}

/**
 * Whether video generation is available: AI and uploads are on (results are stored in R2) and video
 * models are configured.
 */
export const aiVideoEnabled =
  aiEnabled && uploadEnabled && siteConfig.ai.videoModels.length > 0;

export const aiVideoModels = siteConfig.ai.videoModels.map(
  ({ id, creditCost, input, duration }) => ({
    id,
    creditCost,
    input,
    duration,
  }),
);

export const defaultAiVideoModel = siteConfig.ai.defaultVideoModel;

/**
 * Video service bound to the global database, credits, rate limiting, R2, and provider keys from
 * env.
 */
export const videoService = createVideoService({
  db: getDb,
  config: siteConfig.ai,
  credits: { deductCredits, refundCredits },
  checkRateLimit,
  getClient: createVideoClientResolver(env),
  getStorage: getUploadStorage,
  fileUrl: storedFileUrl,
});

/** The current user's videos that are still generating. */
export function listPendingVideos(userId: string) {
  return listPendingVideosFor(getDb(), userId);
}

/**
 * Recovery sweep: advances pending jobs nobody is polling (after the page is closed, the user
 * switches devices, or the function is reclaimed). Triggered by src/core/recovery on a cron or
 * opportunistically; see the notes there.
 */
export const aiRecovery = createAiRecovery({
  db: getDb,
  credits: { deductCredits, refundCredits },
  recoverVideo: videoService.recoverVideo,
});
