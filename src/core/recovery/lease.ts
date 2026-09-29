import { and, eq, lte, sql } from "drizzle-orm";

import type { Database } from "@/core/db/client";
import { jobLeases } from "@/core/db/schema";

/**
 * 抢一次租约。成功返回 true：调用方现在独占这个任务，跑完调 `releaseLease`。
 *
 * - `ttlMs`：租约时长，要比一次运行的最长时间（函数的 maxDuration）长。进程中途死掉时，
 *   到期后别人就能再抢到，不需要人工解锁。
 * - `minIntervalMs`：距上一次**开始**不足这么久就不抢（机会式扫描的限频）；0 表示只看锁。
 *
 * 整个判断是一条 upsert：并发的几个调用方里只有一个能让 WHERE 成立，其余拿到 0 行。
 * 时间一律用数据库的 now()，不受各实例时钟漂移影响。
 */
export async function acquireLease(
  db: Database,
  {
    name,
    ttlMs,
    minIntervalMs = 0,
  }: { name: string; ttlMs: number; minIntervalMs?: number },
): Promise<boolean> {
  const lockedUntil = sql`now() + ${`${ttlMs} milliseconds`}::interval`;
  const rows = await db
    .insert(jobLeases)
    .values({ name, lockedUntil, lastStartedAt: sql`now()` })
    .onConflictDoUpdate({
      target: jobLeases.name,
      set: { lockedUntil, lastStartedAt: sql`now()` },
      setWhere: and(
        lte(jobLeases.lockedUntil, sql`now()`),
        lte(
          jobLeases.lastStartedAt,
          sql`now() - ${`${minIntervalMs} milliseconds`}::interval`,
        ),
      ),
    })
    .returning({ name: jobLeases.name });
  return rows.length > 0;
}

/** 放掉租约并记下结束时间。`lastStartedAt` 不动 —— 限频按开始时间算。 */
export async function releaseLease(db: Database, name: string) {
  await db
    .update(jobLeases)
    .set({ lockedUntil: sql`now()`, lastFinishedAt: sql`now()` })
    .where(eq(jobLeases.name, name));
}
