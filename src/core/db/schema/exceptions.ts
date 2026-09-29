import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

/**
 * Exception kinds. Add new kinds here and update the check constraint to match (`pnpm db:generate`
 * generates the migration).
 * - `refund_reclaim_shortfall`: credits were reclaimed after a payment refund, the balance wasn't
 *   enough, and the difference is still owed.
 * - `ai_job_needs_review`: an AI job's outcome needs a human — the provider status could never be
 *   retrieved, or it was refunded as "provider has no result" (the provider may actually have
 *   succeeded later).
 * - `notification_failed`: a critical transactional email still wasn't sent after all retries
 *   (source_id is pending_notifications.id); it can be resent from the admin panel.
 */
export const billingExceptionKinds = [
  "refund_reclaim_shortfall",
  "ai_job_needs_review",
  "notification_failed",
] as const;
export type BillingExceptionKind = (typeof billingExceptionKinds)[number];

/**
 * open: pending; resolved: handled; ignored: reviewed and decided not to act. The latter two both
 * require a resolution note.
 */
export const billingExceptionStatuses = [
  "open",
  "resolved",
  "ignored",
] as const;
export type BillingExceptionStatus = (typeof billingExceptionStatuses)[number];

/**
 * Places where money or results went wrong and someone needs to look. One row per exception.
 *
 * - `(kind, source, source_id)` is unique: webhook replays and sweep reruns can't open a second
 *   one.
 * - `source` / `source_id` point at the thing that went wrong: the reclaim transaction's
 *   (source, sourceId), or an `ai_usage` row.
 * - `detail` is a snapshot of the context when opened (order number, granted / reclaimed /
 *   shortfall, job id, provider status); later handling updates it.
 * - `attempts` / `last_error`: number of automatic or manual retries and the most recent failure
 *   reason.
 *
 * There is no auto-close: closing requires someone to write a `resolution` (the reason attached to
 * a handling action counts).
 */
export const billingExceptions = pgTable(
  "billing_exceptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind", { enum: billingExceptionKinds }).notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    sourceId: text("source_id").notNull(),
    status: text("status", { enum: billingExceptionStatuses })
      .notNull()
      .default("open"),
    detail: jsonb("detail")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    resolution: text("resolution"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("billing_exceptions_source_unique").on(
      table.kind,
      table.source,
      table.sourceId,
    ),
    // Admin list: open ones first, newest first; the sidebar counts open.
    index("billing_exceptions_status_created_idx").on(
      table.status,
      table.createdAt,
    ),
    check(
      "billing_exceptions_kind_valid",
      sql`${table.kind} in ('refund_reclaim_shortfall', 'ai_job_needs_review', 'notification_failed')`,
    ),
    check(
      "billing_exceptions_status_valid",
      sql`${table.status} in ('open', 'resolved', 'ignored')`,
    ),
  ],
);

export type BillingException = typeof billingExceptions.$inferSelect;

/**
 * Audit log of admin actions: who (actor) did what (action) to what (target) and when, why
 * (reason), and with what outcome (result). Currently only exceptions page actions write here;
 * credit adjustments already carry `actor_id` on the transaction.
 *
 * `actor_id` has no foreign key: audit records must survive the admin account being deleted.
 */
export const adminActions = pgTable(
  "admin_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    targetKind: text("target_kind").notNull(),
    targetId: text("target_id").notNull(),
    reason: text("reason").notNull(),
    result: text("result").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("admin_actions_target_idx").on(
      table.targetKind,
      table.targetId,
      table.createdAt,
    ),
  ],
);

export type AdminAction = typeof adminActions.$inferSelect;
