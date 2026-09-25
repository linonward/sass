import { deductCredits, refundCredits } from "@/core/credits";
import { getDb } from "@/core/db";
import { env } from "@/core/env";
import { checkRateLimit } from "@/core/ratelimit";
import { fileUrl, getUploadStorage, uploadEnabled } from "@/core/upload";

import siteConfig from "../../../site.config";
import { listGenerations as listGenerationsFor } from "./generations";
import { createRunImage } from "./image";
import { createImageModelResolver, createModelResolver } from "./registry";
import { createRunAI } from "./run";

export { AI_CREDIT_SOURCE, type RunAIInput, type RunAIResult } from "./run";
export { imageAspectRatios, type Generation } from "./image";

/** `features.ai` 是否开启。关闭时 AI 路由返回 404，侧边栏不显示 Playground。 */
export const aiEnabled = siteConfig.features.ai;

/** 可选的模型（给前端展示）：只含 id 和积分成本。 */
export const aiModels = siteConfig.ai.models.map(({ id, creditCost }) => ({
  id,
  creditCost,
}));

export const defaultAiModel = siteConfig.ai.defaultModel;

/** 绑定全局数据库、积分、限流和 env 里的服务商 key 的 runAI。 */
export const runAI = createRunAI({
  db: getDb,
  config: siteConfig.ai,
  credits: { deductCredits, refundCredits },
  checkRateLimit,
  getModel: createModelResolver(env),
});

/** 图片生成是否可用：开启 AI 和上传（结果存 R2），且配置了图片模型。 */
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

/** 绑定全局数据库、积分、限流、R2 和 env 里的服务商 key 的 runImage。 */
export const runImage = createRunImage({
  db: getDb,
  config: siteConfig.ai,
  credits: { deductCredits, refundCredits },
  checkRateLimit,
  getModel: createImageModelResolver(env),
  getStorage: getUploadStorage,
  fileUrl: storedFileUrl,
});

/** 当前用户最近的图片、视频生成。 */
export function listGenerations(userId: string) {
  return listGenerationsFor(
    { db: getDb(), fileUrl: storedFileUrl },
    { userId },
  );
}
