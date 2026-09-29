import { and, eq, lte, sql } from "drizzle-orm";

import type { Database } from "@/core/db/client";
import { jobLeases } from "@/core/db/schema";

/**
 * Tries to acquire the lease once. Returns true on success: the caller now owns this job exclusively
 * and must call `releaseLease` when done.
 *
 * - `ttlMs`: lease duration; must be longer than the longest possible run (the function's
 *   maxDuration). If the process dies midway, someone else can grab it once it expires — no manual
 *   unlock needed.
 * - `minIntervalMs`: don't acquire if the previous run **started** less than this long ago (rate
 *   limit for opportunistic sweeps); 0 means only the lock matters.
 *
 * The whole check is a single upsert: among concurrent callers only one can satisfy the WHERE, the
 * rest get 0 rows. All times use the database's now(), so clock drift between instances doesn't
 * matter.
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

/**
 * Releases the lease and records the finish time. `lastStartedAt` is left alone — the rate limit is
 * based on start time.
 */
export async function releaseLease(db: Database, name: string) {
  await db
    .update(jobLeases)
    .set({ lockedUntil: sql`now()`, lastFinishedAt: sql`now()` })
    .where(eq(jobLeases.name, name));
}
