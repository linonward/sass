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
  // 建表时的表达式索引。报表（report.ts 的 sourceOf）后来把「没有归因行 / 已撤回」
  // 的桶从 'unknown' 改成了 '(none)'，谓词表达式已经和它不一样，筛选查询走不到这个
  // 索引，只剩写入侧的成本 —— 要么让查询对上它、要么删掉，两条路都要一次迁移，留给
  // 后续处理（见 report.ts 里的同一条说明）。
  // 另外：表格每注册一次才写一行，索引成本可以忽略；
  // utm_medium / campaign 只用在筛选框里列已出现过的取值，不再各加一条索引。
  (table) => [
    index("user_attribution_source_idx").on(
      sql`coalesce(${table.snapshot}->>'source', 'unknown')`,
    ),
  ],
);
