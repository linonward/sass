import { and, eq } from "drizzle-orm";

import {
  InsufficientCreditsError,
  type AfterCommitCallback,
  type Credits,
} from "@/core/credits";
import type { Database } from "@/core/db/client";
import {
  aiUsage,
  type AiUsageKind,
  type AiUsageStatus,
} from "@/core/db/schema";
import { runAfterResponse } from "@/core/lib/after-response";
import { logger, type LogFn } from "@/core/observability/logger";
import { setSpanAttributes } from "@/core/observability/trace";

/** 积分流水的 source；sourceId 是 ai_usage.id。 */
export const AI_CREDIT_SOURCE = "ai";

export type UsageDeps = {
  db: () => Database;
  credits: Pick<Credits, "deductCredits" | "refundCredits">;
  logError: LogFn;
};

type UsageModel = {
  id: string;
  provider: string;
  model: string;
  creditCost: number;
};

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 1000);
}

/**
 * 一次调用结束时的日志和 span 属性：模型、积分、耗时、结果。
 * 失败原因已经由调用方的 logError 记过，这里不重复。
 */
export function logUsage({
  usageId,
  userId,
  model,
  status,
  durationMs,
  inputTokens,
  outputTokens,
}: {
  usageId: string;
  userId: string;
  model: UsageModel;
  status: AiUsageStatus;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
}) {
  const fields = {
    usageId,
    userId,
    modelId: model.id,
    provider: model.provider,
    credits: model.creditCost,
    status,
    durationMs: Math.max(0, Math.round(durationMs)),
    inputTokens,
    outputTokens,
  };
  logger.info("ai.usage", fields);
  setSpanAttributes({
    "ai.usage_id": usageId,
    "ai.model_id": model.id,
    "ai.provider": model.provider,
    "ai.credits": model.creditCost,
    "ai.status": status,
    "ai.duration_ms": fields.durationMs,
  });
}

/**
 * 写一条 pending 的 ai_usage 并预扣积分，两者在同一个事务里。
 * 余额不足时返回 null（调用方转成 402），其他错误照常抛出。
 */
export async function reserveUsage(
  { db, credits, logError }: UsageDeps,
  {
    userId,
    kind,
    model,
    prompt,
  }: { userId: string; kind: AiUsageKind; model: UsageModel; prompt?: string },
): Promise<string | null> {
  const afterCommit: AfterCommitCallback[] = [];
  let usageId: string;
  try {
    usageId = await db().transaction(async (tx) => {
      const [row] = await tx
        .insert(aiUsage)
        .values({
          userId,
          kind,
          modelId: model.id,
          provider: model.provider,
          model: model.model,
          credits: model.creditCost,
          prompt,
        })
        .returning({ id: aiUsage.id });
      if (model.creditCost > 0) {
        await credits.deductCredits(
          {
            userId,
            amount: model.creditCost,
            source: AI_CREDIT_SOURCE,
            sourceId: row!.id,
            reason: `ai:${model.id}`,
          },
          { tx, afterCommit: (fn) => afterCommit.push(fn) },
        );
      }
      return row!.id;
    });
  } catch (error) {
    if (error instanceof InsufficientCreditsError) return null;
    throw error;
  }
  // 余额不足提醒等回调放到响应之后，不拖慢模型调用的开始。
  await runAfterResponse(async () => {
    for (const fn of afterCommit) {
      try {
        await fn();
      } catch (error) {
        logError("ai.after_commit_failed", error);
      }
    }
  });
  return usageId;
}

/**
 * 结束一次调用：失败时按 ai_usage.id 退回积分（同一 sourceId 只退一次），
 * 然后写入状态、用量和耗时。从不抛错，出错只记日志。
 *
 * `onlyIfPending`：异步任务可能被多个请求同时推进。只有把 pending 改成终态的那一次
 * 才退款，返回 true；记录已经结束时什么都不做，返回 false。
 */
export async function settleUsage(
  { db, credits, logError }: UsageDeps,
  {
    userId,
    usageId,
    model,
    status,
    durationMs,
    inputTokens,
    outputTokens,
    error,
    fileId,
    onlyIfPending = false,
  }: {
    userId: string;
    usageId: string;
    model: UsageModel;
    status: AiUsageStatus;
    durationMs: number;
    inputTokens?: number;
    outputTokens?: number;
    error?: unknown;
    fileId?: string;
    onlyIfPending?: boolean;
  },
): Promise<boolean> {
  const refund = () =>
    status === "failed" && model.creditCost > 0
      ? credits.refundCredits({
          userId,
          source: AI_CREDIT_SOURCE,
          sourceId: usageId,
          reason: `ai_failed:${model.id}`,
        })
      : undefined;
  const update = () =>
    db()
      .update(aiUsage)
      .set({
        status,
        inputTokens: inputTokens ?? null,
        outputTokens: outputTokens ?? null,
        error: error === undefined ? null : errorMessage(error),
        durationMs: Math.max(0, Math.round(durationMs)),
        finishedAt: new Date(),
        ...(fileId ? { fileId } : {}),
      })
      .where(
        onlyIfPending
          ? and(eq(aiUsage.id, usageId), eq(aiUsage.status, "pending"))
          : eq(aiUsage.id, usageId),
      )
      .returning({ id: aiUsage.id });
  try {
    if (onlyIfPending) {
      // 先抢到状态再退款，并发时只有一个请求会退。
      if ((await update()).length === 0) return false;
      await refund();
    } else {
      await refund();
      await update();
    }
    logUsage({
      usageId,
      userId,
      model,
      status,
      durationMs,
      inputTokens,
      outputTokens,
    });
    return true;
  } catch (settleError) {
    logError("ai.settle_failed", { error: settleError, usageId });
    return false;
  }
}
