import { deductCredits, refundCredits } from "@/core/credits";
import { getDb } from "@/core/db";
import { env } from "@/core/env";
import { checkRateLimit } from "@/core/ratelimit";

import siteConfig from "../../../site.config";
import { createModelResolver } from "./registry";
import { createRunAI } from "./run";

export { AI_CREDIT_SOURCE, type RunAIInput, type RunAIResult } from "./run";

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
