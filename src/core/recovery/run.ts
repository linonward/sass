import type { Database } from "@/core/db/client";
import {
  logger,
  type LogFields,
  type LogFn,
} from "@/core/observability/logger";

import { acquireLease, releaseLease } from "./lease";

/** 所有恢复任务共用一把租约：同一时刻只跑一次恢复。 */
export const RECOVERY_LEASE = "recovery";

/**
 * 租约时长：比恢复入口的 maxDuration（300 秒）长。进程中途死掉时，最多等这么久别人就能接手。
 */
export const RECOVERY_LEASE_TTL_MS = 6 * 60 * 1000;

/** 机会式扫描的最小间隔：距上一次恢复开始不足这么久，就不顺带扫了。 */
export const OPPORTUNISTIC_INTERVAL_MS = 5 * 60 * 1000;

export type RecoveryTrigger = "cron" | "opportunistic";

/** 一个恢复任务：处理最多 `limit` 条，返回计数（写进 `<name>.recovery` 日志）。 */
export type RecoveryTask = (options: {
  limit: number;
}) => Promise<Record<string, number>>;

export type RecoveryRun =
  | { ran: false; trigger: RecoveryTrigger }
  | {
      ran: true;
      trigger: RecoveryTrigger;
      results: Record<string, Record<string, number> | { error: true }>;
    };

/**
 * 恢复的运行器：一个入口，多个触发源（cron、机会式），多个任务（目前是 AI 任务）。
 *
 * 抢到租约才跑，跑完放掉；每个任务各自 try/catch，一个出错不影响其它任务，也不会让租约挂着。
 * 每个任务跑完记一条结构化日志 `<name>.recovery`，带上触发源和计数。
 */
export function createRecoveryRunner({
  db,
  tasks,
  leaseName = RECOVERY_LEASE,
  logInfo = logger.info,
  logError = logger.error,
}: {
  db: () => Database;
  leaseName?: string;
  tasks: Record<string, RecoveryTask>;
  logInfo?: (event: string, fields?: LogFields) => void;
  logError?: LogFn;
}) {
  return async function runRecovery({
    trigger,
    limit,
  }: {
    trigger: RecoveryTrigger;
    limit: number;
  }): Promise<RecoveryRun> {
    const acquired = await acquireLease(db(), {
      name: leaseName,
      ttlMs: RECOVERY_LEASE_TTL_MS,
      minIntervalMs:
        trigger === "opportunistic" ? OPPORTUNISTIC_INTERVAL_MS : 0,
    });
    if (!acquired) return { ran: false, trigger };

    const results: Extract<RecoveryRun, { ran: true }>["results"] = {};
    try {
      for (const [name, task] of Object.entries(tasks)) {
        try {
          const counts = await task({ limit });
          results[name] = counts;
          logInfo(`${name}.recovery`, { trigger, ...counts });
        } catch (error) {
          results[name] = { error: true };
          logError(`${name}.recovery_failed`, { error, trigger });
        }
      }
    } finally {
      try {
        await releaseLease(db(), leaseName);
      } catch (error) {
        // 放不掉也没关系：租约到期自己会失效。
        logError("recovery.release_failed", { error });
      }
    }
    return { ran: true, trigger, results };
  };
}

export type RunRecovery = ReturnType<typeof createRecoveryRunner>;
