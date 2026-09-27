import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

// 一人一码：随机生成、不包含也不派生自用户 ID，所以从码反推不出账号，也无法枚举。
export const referralCodes = pgTable(
  "referral_codes",
  {
    code: text("code").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [uniqueIndex("referral_codes_user_idx").on(t.userId)],
);

// 邀请关系：受邀人即主键，写入一次之后不会再改；状态从「等待首次付款」开始，
// 奖励结算只推进状态，不改归属。code 只作历史留痕，不设外键：
// 邀请人删号时关系一并删除（数据删除口径），码本身不参与结算。
export const referralRelationships = pgTable(
  "referral_relationships",
  {
    inviteeUserId: text("invitee_user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    inviterUserId: text("inviter_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    status: text("status", { enum: ["awaiting_payment"] })
      .notNull()
      .default("awaiting_payment"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("referral_relationships_inviter_idx").on(t.inviterUserId)],
);
