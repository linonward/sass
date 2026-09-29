import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

/**
 * 已发送的通知，用于去重：(kind, key) 唯一，last_sent_at 记录最近一次发送时间。
 * 例如 credits-low 以用户为 key、24 小时内最多一次；subscription-canceled 以订阅为 key、只发一次。
 * 删除用户时级联删除。
 */
export const notificationLog = pgTable(
  "notification_log",
  {
    kind: text("kind").notNull(),
    key: text("key").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    lastSentAt: timestamp("last_sent_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.kind, table.key] })],
);

/**
 * 待发送状态：pending 等着发（或等下一次重试），sending 正在发（被某个进程抢到了），
 * sent 发出去了，failed 终态失败（重试用完、验证码过期、被新验证码取代）—— 保留，可人工补发。
 */
export const pendingNotificationStatuses = [
  "pending",
  "sending",
  "sent",
  "failed",
] as const;
export type PendingNotificationStatus =
  (typeof pendingNotificationStatuses)[number];

/**
 * 事务邮件的 outbox：关键邮件先在业务事务里写一行，提交后立即尝试发送；
 * 发不出去就留在这里，由恢复扫描按退避补发（见 src/core/email/outbox.ts）。
 *
 * - `kind` / `key`：和 notification_log 的去重名额同一对值（验证码没有去重名额，
 *   `key` 用来找到同一邮箱上一封还没发出的验证码并作废它）；
 * - `claimed_at`：占去重名额时的时间，终态失败时凭它释放名额（和 notification_log 同类型的列，
 *   比较时编码一致）；没有名额的邮件为 null；
 * - `props`：模板参数。验证码这类敏感内容加密后存放（`{ "enc": "..." }`），发出或作废后清空；
 * - `expires_at`：过期就不再发（验证码过了有效期，发出去也没用）。
 */
export const pendingNotifications = pgTable(
  "pending_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    key: text("key").notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    to: text("to").notNull(),
    template: text("template").notNull(),
    props: jsonb("props").$type<Record<string, unknown>>().notNull(),
    locale: text("locale").notNull(),
    status: text("status", { enum: pendingNotificationStatuses })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    claimedAt: timestamp("claimed_at"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // 扫描只找待发的行；部分索引只收 pending / sending，正常情况下几乎是空的。
    index("pending_notifications_due_idx")
      .on(table.nextRetryAt)
      .where(sql`${table.status} in ('pending', 'sending')`),
    index("pending_notifications_kind_key_idx").on(table.kind, table.key),
    check(
      "pending_notifications_status_valid",
      sql`${table.status} in ('pending', 'sending', 'sent', 'failed')`,
    ),
  ],
);

export type PendingNotification = typeof pendingNotifications.$inferSelect;
