import { pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

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
