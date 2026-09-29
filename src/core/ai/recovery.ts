import { and, asc, eq, inArray, lt, or, sql } from "drizzle-orm";

import type { Credits } from "@/core/credits";
import type { Database } from "@/core/db/client";
import { aiUsage } from "@/core/db/schema";
import { logger, type LogFn } from "@/core/observability/logger";

import { settleUsage } from "./usage";
import type { VideoJob } from "./video";

/**
 * 视频任务提交后多久才进扫描范围。刚提交的行还在 startVideo 里（taskId 可能还没写回），
 * 前端也还在轮询，扫描不去碰它们。
 */
export const RECOVERY_VIDEO_STALE_MS = 2 * 60 * 1000;

/**
 * 文本 / 图片是同一个请求里生成并结算的，函数最长跑 120 秒（图片路由的 maxDuration）。
 * 超过这个时长还是 pending，说明函数在结算前被回收了。它们没有服务商侧的任务 id，
 * 结果只存在于那次请求里 —— 没有可核对的东西，按失败退款，`error` 写明原因。
 */
export const RECOVERY_SYNC_HARD_LIMIT_MS = 15 * 60 * 1000;

/** 一次扫描最多处理的行数：视频要下载转存，名额决定了一次扫描的最长耗时。 */
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
 * 恢复扫描：把没人推进的 pending 行推进到终态。
 *
 * - 视频：交给 `recoverVideo`，和前端轮询走同一条结算路径（先问服务商，有结果先保存，
 *   明确失败或到了硬上限才退款）；
 * - 文本 / 图片：超过 RECOVERY_SYNC_HARD_LIMIT_MS 仍是 pending 的，按失败退款。
 *
 * 并发安全靠结算本身：`settleUsage({ onlyIfPending })` 和视频转存的认领都只让一个调用方
 * 把 pending 改成终态，退款按 `(source, sourceId)` 唯一，所以扫描和前端轮询撞在同一行上
 * 也只结算一次、只退一次。同一批行扫两次，结果相同。
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
    // 只扫这些用户的任务（测试隔离、按用户重试时用）；不传扫全部。
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
      // 没看过的先看，其次看得最久远的：一时结不了的行不会每次都占住名额。
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
        // 先记下「看过了」再推进：推进途中进程死掉，下一次扫描也会先去看别的行。
        await db()
          .update(aiUsage)
          .set({ recoveryCheckedAt: new Date(at) })
          .where(eq(aiUsage.id, row.id));

        if (row.kind === "video") {
          const job = await recoverVideo(row.id);
          // null：这一行在查询之后被删了（用户注销账户），没有要推进的东西。
          if (job) result[job.status] += 1;
          continue;
        }

        await settleUsage(
          { db, credits, logError },
          {
            userId: row.userId,
            usageId: row.id,
            // 按预扣时记下的积分退，不受之后改配置影响。
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
        // 不管这次是不是本扫描结算的，读一次终态再计数（并发时另一方可能先结了）。
        const [after] = await db()
          .select({ status: aiUsage.status })
          .from(aiUsage)
          .where(eq(aiUsage.id, row.id));
        if (after?.status === "succeeded") result.succeeded += 1;
        else if (after?.status === "pending") result.pending += 1;
        else result.failed += 1;
      } catch (error) {
        // 一行出错不拖累其它行；这一行下次扫描再来。
        result.errors += 1;
        logError("ai.recovery_row_failed", { error, usageId: row.id });
      }
    }
    return result;
  };
}

export type AiRecovery = ReturnType<typeof createAiRecovery>;
