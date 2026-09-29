import { and, asc, eq, inArray, lt, or, sql } from "drizzle-orm";

import type { Credits } from "@/core/credits";
import type { Database } from "@/core/db/client";
import { aiUsage } from "@/core/db/schema";
import { logger, type LogFn } from "@/core/observability/logger";

import { settleUsage } from "./usage";
import type { VideoJob } from "./video";

/**
 * How long after submission a video job enters the sweep. Freshly submitted rows are still inside
 * startVideo (the taskId may not be written back yet) and the frontend is still polling them, so
 * the sweep leaves them alone.
 */
export const RECOVERY_VIDEO_STALE_MS = 2 * 60 * 1000;

/**
 * Text / image are generated and settled within a single request, and the function runs for at most
 * 120 seconds (the image route's maxDuration). Still pending past this limit means the function was
 * reclaimed before settling. They have no provider-side job id and the result only existed in that
 * request — there's nothing to reconcile, so they are refunded as failed, with the reason in
 * `error`.
 */
export const RECOVERY_SYNC_HARD_LIMIT_MS = 15 * 60 * 1000;

/**
 * Maximum rows handled per sweep: videos have to be downloaded and stored, so this quota bounds how
 * long one sweep can take.
 */
export const RECOVERY_DEFAULT_LIMIT = 10;

export type AiRecoveryResult = {
  scanned: number;
  succeeded: number;
  failed: number;
  pending: number;
  errors: number;
};

export type AiRecoveryDeps = {
  db: () => Database;
  credits: Pick<Credits, "deductCredits" | "refundCredits">;
  recoverVideo: (id: string) => Promise<VideoJob | null>;
  now?: () => number;
  logError?: LogFn;
};

/**
 * Recovery sweep: drives pending rows that nobody is advancing to a terminal state.
 *
 * - Video: handed to `recoverVideo`, which takes the same settlement path as frontend polling (ask
 *   the provider first, save any result first, and refund only on an explicit failure or the hard
 *   limit);
 * - Text / image: rows still pending past RECOVERY_SYNC_HARD_LIMIT_MS are refunded as failed.
 *
 * Concurrency safety comes from settlement itself: `settleUsage({ onlyIfPending })` and the claim
 * on the video copy both let only one caller move pending to a terminal state, and refunds are
 * unique per `(source, sourceId)`, so even when the sweep and frontend polling hit the same row it
 * is settled once and refunded once. Sweeping the same rows twice gives the same result.
 */
export function createAiRecovery({
  db,
  credits,
  recoverVideo,
  now = Date.now,
  logError = logger.error,
}: AiRecoveryDeps) {
  return async function scanAi({
    limit = RECOVERY_DEFAULT_LIMIT,
    userIds,
  }: {
    limit?: number;
    // Only sweep these users' jobs (for test isolation and per-user retries); omit to sweep all.
    userIds?: string[];
  } = {}): Promise<AiRecoveryResult> {
    const at = now();
    const rows = await db()
      .select()
      .from(aiUsage)
      .where(
        and(
          eq(aiUsage.status, "pending"),
          userIds ? inArray(aiUsage.userId, userIds) : undefined,
          or(
            and(
              eq(aiUsage.kind, "video"),
              lt(aiUsage.createdAt, new Date(at - RECOVERY_VIDEO_STALE_MS)),
            ),
            and(
              inArray(aiUsage.kind, ["text", "image"]),
              lt(aiUsage.createdAt, new Date(at - RECOVERY_SYNC_HARD_LIMIT_MS)),
            ),
          ),
        ),
      )
      // Unchecked rows first, then the least recently checked: rows that can't settle yet don't hog
      // the quota on every sweep.
      .orderBy(
        sql`${aiUsage.recoveryCheckedAt} asc nulls first`,
        asc(aiUsage.createdAt),
      )
      .limit(limit);

    const result: AiRecoveryResult = {
      scanned: rows.length,
      succeeded: 0,
      failed: 0,
      pending: 0,
      errors: 0,
    };
    for (const row of rows) {
      try {
        // Mark the row as checked before advancing it: if the process dies midway, the next sweep
        // still looks at other rows first.
        await db()
          .update(aiUsage)
          .set({ recoveryCheckedAt: new Date(at) })
          .where(eq(aiUsage.id, row.id));

        if (row.kind === "video") {
          const job = await recoverVideo(row.id);
          // null: the row was deleted after the query (the user deleted their account); nothing to
          // advance.
          if (job) result[job.status] += 1;
          continue;
        }

        await settleUsage(
          { db, credits, logError },
          {
            userId: row.userId,
            usageId: row.id,
            // Refund the credits recorded at pre-deduction, unaffected by later config changes.
            model: {
              id: row.modelId,
              provider: row.provider,
              model: row.model,
              creditCost: row.credits,
            },
            status: "failed",
            durationMs: at - row.createdAt.getTime(),
            error:
              "interrupted: request ended before the result was recorded (no provider task to check)",
            onlyIfPending: true,
          },
        );
        // Whether or not this sweep settled it, read the terminal state once before counting (under
        // concurrency another caller may have settled it first).
        const [after] = await db()
          .select({ status: aiUsage.status })
          .from(aiUsage)
          .where(eq(aiUsage.id, row.id));
        if (after?.status === "succeeded") result.succeeded += 1;
        else if (after?.status === "pending") result.pending += 1;
        else result.failed += 1;
      } catch (error) {
        // One failing row doesn't hold up the others; it gets retried on the next sweep.
        result.errors += 1;
        logError("ai.recovery_row_failed", { error, usageId: row.id });
      }
    }
    return result;
  };
}

export type AiRecovery = ReturnType<typeof createAiRecovery>;
