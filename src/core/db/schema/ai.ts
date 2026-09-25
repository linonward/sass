import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

export const aiUsageStatuses = [
  // 已预扣积分，模型还在生成。
  "pending",
  "succeeded",
  // 模型报错，积分已退回。
  "failed",
  // 调用方通过 abortSignal 中止；模型已经产生了用量，积分不退。
  "aborted",
] as const;
export type AiUsageStatus = (typeof aiUsageStatuses)[number];

/**
 * 每次 AI 调用一行。id 同时是积分扣减流水的 source_id（source 为 "ai"），
 * 退款按它找到原扣减。
 */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // site.config.ts 中 ai.models 的 id，以及当时对应的服务商和模型名。
    modelId: text("model_id").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    // 预扣的积分；失败退回后仍保留原值，退款记录在 credit_transactions。
    credits: integer("credits").notNull(),
    status: text("status").$type<AiUsageStatus>().notNull().default("pending"),
    error: text("error"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
  },
  (table) => [
    index("ai_usage_user_created_idx").on(table.userId, table.createdAt),
    check(
      "ai_usage_status_valid",
      sql`${table.status} in ('pending', 'succeeded', 'failed', 'aborted')`,
    ),
  ],
);
