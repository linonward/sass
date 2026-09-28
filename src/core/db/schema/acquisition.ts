import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { Attribution } from "@/core/acquisition/context";
import { leads } from "./leads";
import { user } from "./auth";

// Missing row = unknown (including pre-feature users). A null snapshot is a
// withdrawal tombstone: replaying a registration retry must not restore it.
export const userAttribution = pgTable(
  "user_attribution",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    leadId: text("lead_id").references(() => leads.id, {
      onDelete: "set null",
    }),
    snapshot: jsonb("snapshot").$type<Attribution>(),
    registeredAt: timestamp("registered_at", { withTimezone: true }).notNull(),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
  },
  // user_attribution.userId 是主键（自带索引），报表四组聚合的 LEFT JOIN 都走它。
  // source / utm_medium / utm_campaign 是快照里的 jsonb 字段，只在筛选下拉里做
  // distinct 取值用 —— 表每注册一行，全表 distinct 的开销可以忽略，不再各建表达式索引。
);
