// 用户上传到 R2 的文件。对象 key 的格式是 <userId>/<yyyy-mm>/<uuid>.<ext>。
// user_id 的外键是 cascade：删除账户时文件记录随之删除，R2 上的对象不会自动清理（v1 不做）。
import { bigint, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";

// pending：已签发上传地址，还没确认；uploaded：已确认对象存在，大小和类型与签发时一致。
export const fileStatuses = ["pending", "uploaded"] as const;
export type FileStatus = (typeof fileStatuses)[number];

export const files = pgTable(
  "files",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    key: text("key").notNull().unique(),
    // 字节数。单个文件最大 5 GiB，超出 integer 范围，用 bigint。
    size: bigint("size", { mode: "number" }).notNull(),
    mime: text("mime").notNull(),
    status: text("status", { enum: fileStatuses }).notNull().default("pending"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("files_user_idx").on(t.userId, t.createdAt)],
);

export type FileRecord = typeof files.$inferSelect;
