import type { Database } from "@/core/db/client";
import {
  logger,
  type LogFields,
  type LogFn,
} from "@/core/observability/logger";

import { acquireLease, releaseLease } from "./lease";

/** All recovery tasks share one lease: only one recovery runs at a time. */
export const RECOVERY_LEASE = "recovery";

/**
 * Lease duration: longer than the recovery endpoint's maxDuration (300 seconds). If the process dies
 * midway, someone else can take over after at most this long.
 */
export const RECOVERY_LEASE_TTL_MS = 6 * 60 * 1000;

/**
 * Minimum interval for opportunistic sweeps: if the last recovery started less than this long ago,
 * skip the piggyback sweep.
 */
export const OPPORTUNISTIC_INTERVAL_MS = 5 * 60 * 1000;

export type RecoveryTrigger = "cron" | "opportunistic";

/**
 * One recovery task: handles up to `limit` items and returns counts (written to the
 * `<name>.recovery` log).
 */
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
 * The recovery runner: one entry point, several triggers (cron, opportunistic), several tasks
 * (currently AI tasks).
 *
 * It runs only after acquiring the lease and releases it when done. Each task has its own
 * try/catch, so one failure does not affect the others or leave the lease held. After each task it
 * writes one structured log `<name>.recovery` with the trigger and the counts.
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
        // Failing to release is fine: the lease expires on its own.
        logError("recovery.release_failed", { error });
      }
    }
    return { ran: true, trigger, results };
  };
}

export type RunRecovery = ReturnType<typeof createRecoveryRunner>;
