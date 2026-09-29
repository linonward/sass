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
 * 异常单的种类。新增种类时加在这里，并同步 check 约束（`pnpm db:generate` 会生成迁移）。
 * - `refund_reclaim_shortfall`：支付退款后回收积分，余额不够，差额还欠着；
 * - `ai_job_needs_review`：AI 任务的结论需要人看 —— 服务商状态一直查不到，
 *   或者按「服务商没有结果」退了款（服务商后来可能其实成功了）。
 */
export const billingExceptionKinds = [
  "refund_reclaim_shortfall",
  "ai_job_needs_review",
] as const;
export type BillingExceptionKind = (typeof billingExceptionKinds)[number];

/** open：待处理；resolved：处理完了；ignored：看过，决定不处理。后两者都要写处理说明。 */
export const billingExceptionStatuses = [
  "open",
  "resolved",
  "ignored",
] as const;
export type BillingExceptionStatus = (typeof billingExceptionStatuses)[number];

/**
 * 钱或结果出问题、需要有人看的地方。一行一张异常单。
 *
 * - `(kind, source, source_id)` 唯一：webhook 重放、扫描重跑都开不出第二张；
 * - `source` / `source_id` 指向出问题的东西：回收流水的 (source, sourceId)、`ai_usage` 行；
 * - `detail` 是开单时的上下文快照（订单号、授予 / 已回收 / 差额、任务 id、服务商状态），
 *   之后的处理会更新它；
 * - `attempts` / `last_error`：自动或手动重试的次数和最近一次的失败原因。
 *
 * 不做自动关闭：关单必须有人写 `resolution`（处理动作本身带的理由也算）。
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
    // 后台列表：待处理的在前，新的在前；侧边栏数 open。
    index("billing_exceptions_status_created_idx").on(
      table.status,
      table.createdAt,
    ),
    check(
      "billing_exceptions_kind_valid",
      sql`${table.kind} in ('refund_reclaim_shortfall', 'ai_job_needs_review')`,
    ),
    check(
      "billing_exceptions_status_valid",
      sql`${table.status} in ('open', 'resolved', 'ignored')`,
    ),
  ],
);

export type BillingException = typeof billingExceptions.$inferSelect;

/**
 * 后台动作的审计：谁（actor）在什么时候对什么（target）做了什么（action）、为什么（reason）、
 * 结果如何（result）。目前只有异常台的动作写这里；积分调整在流水上已有 `actor_id`。
 *
 * `actor_id` 不设外键：管理员账号删掉之后，审计记录仍要留着。
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
