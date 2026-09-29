import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { files } from "./files";

export const aiUsageStatuses = [
  // Credits pre-deducted; the model is still generating.
  "pending",
  "succeeded",
  // The model errored; credits have been refunded.
  "failed",
  // The caller aborted via abortSignal; the model already incurred usage, so credits aren't
  // refunded.
  "aborted",
] as const;
export type AiUsageStatus = (typeof aiUsageStatuses)[number];

// Call kind: text (runAI), image (runImage), video.
export const aiUsageKinds = ["text", "image", "video"] as const;
export type AiUsageKind = (typeof aiUsageKinds)[number];

/**
 * One row per AI call. The id is also the source_id of the credit deduction transaction (source
 * "ai"); refunds use it to find the original deduction.
 */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // The id from ai.models in site.config.ts, plus the provider and model name it mapped to at the
    // time.
    kind: text("kind").$type<AiUsageKind>().notNull().default("text"),
    modelId: text("model_id").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    // Credits pre-deducted; keeps the original value after a failure refund, and the refund is
    // recorded in credit_transactions.
    credits: integer("credits").notNull(),
    status: text("status").$type<AiUsageStatus>().notNull().default("pending"),
    // Prompt for image and video calls, used to display generation history; text calls don't
    // record conversation content.
    prompt: text("prompt"),
    // The file for the result once stored in R2. Set to null when the file record is deleted.
    fileId: text("file_id").references(() => files.id, {
      onDelete: "set null",
    }),
    // Identifier of the async job (video) on the provider's side, e.g. { taskId }. Used to poll
    // status.
    operation: jsonb("operation").$type<{ taskId: string }>(),
    error: text("error"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
    // When the recovery sweep last looked at this row (see src/core/ai/recovery.ts). The sweep
    // rotates by it, so rows that can't be settled for now (say, a video that keeps failing to
    // store) don't take up the limited slots on every pass.
    recoveryCheckedAt: timestamp("recovery_checked_at"),
  },
  (table) => [
    index("ai_usage_user_created_idx").on(table.userId, table.createdAt),
    // The recovery sweep only looks for pending rows; the partial index holds only those and is
    // nearly empty under normal conditions.
    index("ai_usage_pending_idx")
      .on(table.recoveryCheckedAt, table.createdAt)
      .where(sql`${table.status} = 'pending'`),
    // Admin metrics count calls by time range.
    index("ai_usage_created_idx").on(table.createdAt),
    check(
      "ai_usage_status_valid",
      sql`${table.status} in ('pending', 'succeeded', 'failed', 'aborted')`,
    ),
    check(
      "ai_usage_kind_valid",
      sql`${table.kind} in ('text', 'image', 'video')`,
    ),
  ],
);
