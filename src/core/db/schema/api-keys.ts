// 用户自己的 API Key。明文只在创建时返回一次，库里只存 SHA-256 哈希。
// user_id 的外键是 cascade：删除账户时它的 key 一并删除。
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

/**
 * 一行 = 一把 key。
 *
 * - `prefix`：明文的前 10 位（`sk_` + 8 位），只用于在界面上辨认是哪把 key，
 *   本身不足以反推出完整明文；
 * - `hashedKey`：完整明文的 SHA-256（hex），鉴权按它查，不存明文也不存可逆的加密值；
 * - `revokedAt` 为 null 表示有效；撤销就是写这一列，不删行（历史留痕）；
 * - `expiresAt` 为 null 表示不过期；到期后鉴权按无效处理。
 */
export const userApiKeys = pgTable(
  "user_api_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // 用户自己起的名字，同一用户名下唯一（重名会让列表里分不清哪把是哪把）。
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    hashedKey: text("hashed_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    // 最后一次通过鉴权的时间，null 表示从没用过。
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("user_api_keys_user_name_idx").on(t.userId, t.name),
    // 鉴权路径上唯一的查询条件。
    index("user_api_keys_hashed_key_idx").on(t.hashedKey),
  ],
);

export type UserApiKeyRecord = typeof userApiKeys.$inferSelect;
