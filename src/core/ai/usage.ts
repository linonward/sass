import { eq } from "drizzle-orm";

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

/** 积分流水的 source；sourceId 是 ai_usage.id。 */
export const AI_CREDIT_SOURCE = "ai";

export type UsageDeps = {
  db: () => Database;
  credits: Pick<Credits, "deductCredits" | "refundCredits">;
  logError: (message: string, error: unknown) => void;
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
  for (const fn of afterCommit) {
    try {
      await fn();
    } catch (error) {
      logError("[ai] afterCommit callback failed", error);
    }
  }
  return usageId;
}

/**
 * 结束一次调用：失败时按 ai_usage.id 退回积分（同一 sourceId 只退一次），
 * 然后写入状态、用量和耗时。从不抛错，出错只记日志。
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
  },
) {
  try {
    if (status === "failed" && model.creditCost > 0) {
      await credits.refundCredits({
        userId,
        source: AI_CREDIT_SOURCE,
        sourceId: usageId,
        reason: `ai_failed:${model.id}`,
      });
    }
    await db()
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
      .where(eq(aiUsage.id, usageId));
  } catch (settleError) {
    logError(`[ai] failed to settle usage ${usageId}`, settleError);
  }
}
