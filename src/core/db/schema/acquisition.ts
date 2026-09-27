import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
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
  // 渠道报表（/admin/acquisition）按冻结来源分组和筛选，表达式要和 report.ts 里的
  // sourceOf 完全一致才走得到这个索引。表格每注册一次才写一行，索引成本可以忽略；
  // utm_medium / campaign 只用在筛选框里列已出现过的取值，不再各加一条索引。
  (table) => [
    index("user_attribution_source_idx").on(
      sql`coalesce(${table.snapshot}->>'source', 'unknown')`,
    ),
  ],
);
