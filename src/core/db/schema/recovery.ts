import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Leases for background jobs: one row per job name (e.g. `recovery`).
 *
 * The recovery sweep is triggered from several sources — the platform's cron, a self-hosted
 * scheduler, opportunistic sweeps piggybacking on user requests — and only one may run at a time,
 * with the opportunistic ones also rate-limited. Both rely on an atomic UPDATE on this row:
 * an unexpired `lockedUntil` means someone is running; `lastStartedAt` decides whether it's been
 * long enough since the last sweep. If a process dies midway, the lease expires and releases
 * itself, no manual unlock needed (see src/core/recovery/lease.ts).
 */
export const jobLeases = pgTable("job_leases", {
  name: text("name").primaryKey(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }).notNull(),
  lastStartedAt: timestamp("last_started_at", { withTimezone: true }).notNull(),
  lastFinishedAt: timestamp("last_finished_at", { withTimezone: true }),
});
