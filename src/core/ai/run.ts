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
import { logger, type LogFn } from "@/core/observability/logger";
import { recordSpanError, startSpan } from "@/core/observability/trace";
import type {
  RateLimitIdentifiers,
  RateLimitResult,
} from "@/core/ratelimit/limiter";
import { rateLimitResponse } from "@/core/ratelimit/limiter";

import { reserveUsage, settleUsage, type UsageDeps } from "./usage";

export { AI_CREDIT_SOURCE } from "./usage";

export type RunAIInput = Prompt &
  LanguageModelCallOptions & {
    // The signed-in user; returns 401 when empty.
    userId: string | null | undefined;
    // Client IP, used for per-IP rate limiting (getClientIp(request.headers)).
    ip?: string | null;
    // An id from ai.models in site.config.ts; defaults to ai.defaultModel.
    modelId?: string;
    // Pass one to be able to abort generation (e.g. request.signal). On abort the model has already
    // incurred usage, so credits are not refunded.
    abortSignal?: AbortSignal;
    // Number of automatic retries on provider errors (AI SDK default: 2).
    maxRetries?: number;
  };

type StreamResult = ReturnType<typeof streamText>;

export type RunAIResult =
  | {
      ok: true;
      usageId: string;
      model: AiModel;
      // The streamText result: use toUIMessageStreamResponse(), textStream, await text, etc. as
      // usual.
      result: StreamResult;
      // Resolves once the call ends (success, failure with refund, or abort) and ai_usage is
      // written; never rejects. In routes use next/server's after(() => settled) so accounting can
      // still finish after the response ends.
      settled: Promise<AiUsageStatus>;
    }
  | {
      ok: false;
      status: 400 | 401 | 402 | 429 | 503;
      // A response you can return to the client directly (JSON: { error }, with Retry-After when
      // rate limited).
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
  // Resolves the model from config; returns null when that provider has no key configured.
  getModel: (model: AiModel) => LanguageModel | null;
  now?: () => number;
  logError?: LogFn;
};

function fail(status: 400 | 401 | 402 | 503, error: string) {
  return {
    ok: false as const,
    status,
    response: Response.json({ error }, { status }),
  };
}

/**
 * Creates runAI. The default instance is in `./index.ts`; tests inject mock models, database, and
 * rate limiting.
 *
 * Order: check sign-in → pick model → rate limit (ai policy) → pre-deduct credits and write
 * ai_usage (same transaction) → call the model. On a model error the credits are refunded by
 * ai_usage.id; on success the token usage and duration are recorded.
 */
export function createRunAI({
  db,
  config,
  credits,
  checkRateLimit,
  getModel,
  now = Date.now,
  logError = logger.error,
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

    // The pre-deduction and ai_usage share one transaction: either both are written or neither is.
    const usageId = await reserveUsage(usageDeps, {
      userId,
      kind: "text",
      model,
    });
    if (!usageId) return fail(402, "insufficient_credits");

    const startedAt = now();
    // A streaming call only ends after the route returns, so the span is opened manually and ended
    // in finish.
    const span = startSpan("ai.text", {
      "ai.usage_id": usageId,
      "ai.model_id": model.id,
      "ai.provider": model.provider,
      "ai.credits": model.creditCost,
    });
    let settle!: (status: AiUsageStatus) => void;
    const settled = new Promise<AiUsageStatus>((resolve) => {
      settle = resolve;
    });
    let finished = false;

    // Runs only once: streamText may still call onEnd after onError.
    async function finish(
      status: AiUsageStatus,
      details: { usage?: LanguageModelUsage; error?: unknown } = {},
    ) {
      if (finished) return;
      finished = true;
      span.setAttribute("ai.status", status);
      if (status === "failed") recordSpanError(span, details.error);
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
      span.end();
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
          logError("ai.model_failed", {
            error,
            kind: "text",
            modelId: model.id,
          });
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
      // Synchronous exceptions such as invalid arguments: credits were already pre-deducted, so
      // refund them too.
      await finish("failed", { error });
      throw error;
    }
    // The server reads the stream to the end: if the client disconnects, generation still finishes,
    // onEnd / onError always fire, and credits and usage are never left hanging.
    void result.consumeStream();

    return { ok: true, usageId, model, result, settled };
  };
}

export type RunAI = ReturnType<typeof createRunAI>;
