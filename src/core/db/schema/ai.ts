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
  // 已预扣积分，模型还在生成。
  "pending",
  "succeeded",
  // 模型报错，积分已退回。
  "failed",
  // 调用方通过 abortSignal 中止；模型已经产生了用量，积分不退。
  "aborted",
] as const;
export type AiUsageStatus = (typeof aiUsageStatuses)[number];

// 调用类型：文本（runAI）、图片（runImage）、视频。
export const aiUsageKinds = ["text", "image", "video"] as const;
export type AiUsageKind = (typeof aiUsageKinds)[number];

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
    kind: text("kind").$type<AiUsageKind>().notNull().default("text"),
    modelId: text("model_id").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    // 预扣的积分；失败退回后仍保留原值，退款记录在 credit_transactions。
    credits: integer("credits").notNull(),
    status: text("status").$type<AiUsageStatus>().notNull().default("pending"),
    // 图片、视频的提示词，用于展示生成记录；文本调用不记录对话内容。
    prompt: text("prompt"),
    // 生成结果存进 R2 后的文件。文件记录删除时置空。
    fileId: text("file_id").references(() => files.id, {
      onDelete: "set null",
    }),
    // 异步任务（视频）在服务商那边的标识，例如 { taskId }。查询状态时用。
    operation: jsonb("operation").$type<{ taskId: string }>(),
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
    check(
      "ai_usage_kind_valid",
      sql`${table.kind} in ('text', 'image', 'video')`,
    ),
  ],
);
