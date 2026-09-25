import {
  streamText,
  type LanguageModel,
  type LanguageModelCallOptions,
  type LanguageModelUsage,
  type Prompt,
} from "ai";

import type { AiConfig, AiModel } from "@/core/config/schema";
import type { Credits } from "@/core/credits";
import type { Database } from "@/core/db/client";
import type { AiUsageStatus } from "@/core/db/schema";
import type {
  RateLimitIdentifiers,
  RateLimitResult,
} from "@/core/ratelimit/limiter";
import { rateLimitResponse } from "@/core/ratelimit/limiter";

import { reserveUsage, settleUsage, type UsageDeps } from "./usage";

export { AI_CREDIT_SOURCE } from "./usage";

export type RunAIInput = Prompt &
  LanguageModelCallOptions & {
    // 当前登录用户；为空时返回 401。
    userId: string | null | undefined;
    // 客户端 IP，用于按 IP 限流（getClientIp(request.headers)）。
    ip?: string | null;
    // site.config.ts 中 ai.models 的 id；不填用 ai.defaultModel。
    modelId?: string;
    // 传入后可以中止生成（比如 request.signal）。中止时模型已产生用量，积分不退。
    abortSignal?: AbortSignal;
    // 服务商报错时的自动重试次数（AI SDK 默认 2）。
    maxRetries?: number;
  };

type StreamResult = ReturnType<typeof streamText>;

export type RunAIResult =
  | {
      ok: true;
      usageId: string;
      model: AiModel;
      // streamText 的结果：toUIMessageStreamResponse()、textStream、await text 等照常使用。
      result: StreamResult;
      // 调用结束（成功、失败退款或中止）并写完 ai_usage 后 resolve，从不 reject。
      // 路由里用 next/server 的 after(() => settled)，确保响应结束后记账还能跑完。
      settled: Promise<AiUsageStatus>;
    }
  | {
      ok: false;
      status: 400 | 401 | 402 | 429 | 503;
      // 可以直接 return 给客户端的响应（JSON：{ error }，限流时带 Retry-After）。
      response: Response;
    };

export type RunAIDeps = {
  db: Database | (() => Database);
  config: AiConfig;
  credits: Pick<Credits, "deductCredits" | "refundCredits">;
  checkRateLimit: (
    policy: string,
    identifiers: RateLimitIdentifiers,
  ) => Promise<RateLimitResult>;
  // 按配置取模型；该服务商没有配置 key 时返回 null。
  getModel: (model: AiModel) => LanguageModel | null;
  now?: () => number;
  logError?: (message: string, error: unknown) => void;
};

function fail(status: 400 | 401 | 402 | 503, error: string) {
  return {
    ok: false as const,
    status,
    response: Response.json({ error }, { status }),
  };
}

/**
 * 创建 runAI。默认实例见 `./index.ts`；测试注入 mock 模型、数据库和限流。
 *
 * 顺序：检查登录 → 选模型 → 限流（ai 策略）→ 预扣积分并写 ai_usage（同一事务）→ 调用模型。
 * 模型报错时按 ai_usage.id 退回积分；成功时记录 token 用量和耗时。
 */
export function createRunAI({
  db,
  config,
  credits,
  checkRateLimit,
  getModel,
  now = Date.now,
  logError = console.error,
}: RunAIDeps) {
  const usageDeps: UsageDeps = {
    db: () => (typeof db === "function" ? db() : db),
    credits,
    logError,
  };

  return async function runAI(input: RunAIInput): Promise<RunAIResult> {
    const { userId, ip, modelId, abortSignal, ...options } = input;
    if (!userId) return fail(401, "unauthorized");

    const model = config.models.find(
      (m) => m.id === (modelId ?? config.defaultModel),
    );
    if (!model) return fail(400, "invalid_model");
    const languageModel = getModel(model);
    if (!languageModel) return fail(503, "model_unavailable");

    const limit = await checkRateLimit("ai", { userId, ip });
    if (!limit.ok) {
      return {
        ok: false,
        status: limit.reason === "limited" ? 429 : 503,
        response: rateLimitResponse(limit),
      };
    }

    // 预扣和 ai_usage 在同一个事务里：要么都写入，要么都没有。
    const usageId = await reserveUsage(usageDeps, {
      userId,
      kind: "text",
      model,
    });
    if (!usageId) return fail(402, "insufficient_credits");

    const startedAt = now();
    let settle!: (status: AiUsageStatus) => void;
    const settled = new Promise<AiUsageStatus>((resolve) => {
      settle = resolve;
    });
    let finished = false;

    // 只执行一次：onError 之后 streamText 可能还会调用 onEnd。
    async function finish(
      status: AiUsageStatus,
      details: { usage?: LanguageModelUsage; error?: unknown } = {},
    ) {
      if (finished) return;
      finished = true;
      await settleUsage(usageDeps, {
        userId: userId!,
        usageId: usageId!,
        model: model!,
        status,
        durationMs: now() - startedAt,
        inputTokens: details.usage?.inputTokens,
        outputTokens: details.usage?.outputTokens,
        error: details.error,
      });
      settle(status);
    }

    let result: StreamResult;
    try {
      result = streamText({
        ...options,
        model: languageModel,
        maxOutputTokens: options.maxOutputTokens ?? model.maxOutputTokens,
        reasoning: options.reasoning ?? model.reasoning,
        abortSignal,
        onError: ({ error }) => {
          logError(`[ai] model ${model.id} failed`, error);
          return finish("failed", { error });
        },
        onEnd: ({ totalUsage, finishReason }) =>
          finishReason === "error"
            ? finish("failed", {
                usage: totalUsage,
                error: "finish_reason_error",
              })
            : finish("succeeded", { usage: totalUsage }),
        onAbort: () => finish("aborted"),
      });
    } catch (error) {
      // 参数错误等同步异常：积分已经预扣，同样退回。
      await finish("failed", { error });
      throw error;
    }
    // 服务端把流读完：客户端断开时生成照常结束，onEnd / onError 一定会触发，积分和用量不会悬空。
    void result.consumeStream();

    return { ok: true, usageId, model, result, settled };
  };
}

export type RunAI = ReturnType<typeof createRunAI>;
