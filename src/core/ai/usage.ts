import { and, eq } from "drizzle-orm";

import {
  InsufficientCreditsError,
  type AfterCommitCallback,
  type Credits,
} from "@/core/credits";
import type { Database, DbTransaction } from "@/core/db/client";
import {
  aiUsage,
  type AiUsageKind,
  type AiUsageStatus,
} from "@/core/db/schema";
import { runAfterResponse } from "@/core/lib/after-response";
import { logger, type LogFn } from "@/core/observability/logger";
import { setSpanAttributes } from "@/core/observability/trace";

/** The source of the credit transactions; sourceId is ai_usage.id. */
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
 * Log and span attributes at the end of a call: model, credits, duration, outcome.
 * The failure reason has already been logged by the caller's logError, so it isn't repeated here.
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
 * Writes a pending ai_usage row and pre-deducts credits, both in the same transaction.
 * Returns null on insufficient balance (the caller turns it into a 402); other errors are thrown as
 * usual.
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
  // Callbacks such as the low-balance alert run after the response so they don't delay the start of
  // the model call.
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
 * Finishes a call: on failure, refunds the credits by ai_usage.id (only once per sourceId), then
 * writes the status, usage, and duration. Never throws; errors are only logged.
 *
 * `onlyIfPending`: an async job may be advanced by several requests at once. Only the call that
 * moves pending to a terminal state refunds and returns true; if the record has already finished,
 * it does nothing and returns false.
 *
 * `inSettlement`: when settlement actually happens, do one more thing in the same transaction (e.g.
 * open an exception) — committed or rolled back together with the status and refund.
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
    inSettlement,
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
    inSettlement?: (tx: DbTransaction) => Promise<void>;
  },
): Promise<boolean> {
  const refund = (tx: DbTransaction) =>
    status === "failed" && model.creditCost > 0
      ? credits.refundCredits(
          {
            userId,
            source: AI_CREDIT_SOURCE,
            sourceId: usageId,
            reason: `ai_failed:${model.id}`,
          },
          { tx },
        )
      : undefined;
  const update = (executor: Database | DbTransaction) =>
    executor
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
    // Status and refund must be in the same transaction. onlyIfPending claims the status first to
    // dedupe concurrent calls, but if the refund failed outside the transaction it would leave a
    // row that is terminal with the money not refunded — later queries return the terminal state
    // directly, with no way to retry. Rolling back together lets the next query try again.
    const settled = await db().transaction(async (tx) => {
      if (onlyIfPending) {
        if ((await update(tx)).length === 0) return false;
        await refund(tx);
      } else {
        await refund(tx);
        await update(tx);
      }
      await inSettlement?.(tx);
      return true;
    });
    if (!settled) return false;
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
