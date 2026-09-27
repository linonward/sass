import {
  index,
  integer,
  jsonb,
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

/**
 * 邀请关系：受邀人即主键，写入一次之后不会再改；状态从「等待首次付款」开始，
 * 奖励结算只推进状态，不改归属。code 只作历史留痕，不设外键：
 * 邀请人删号时关系一并删除（数据删除口径），码本身不参与结算。
 *
 * rule_snapshot 冻结奖励规则版本：创建关系时的 config snapshot，奖励发放按它判定，
 * 而不是按当前 config，确保规则变更不影响已有关系。
 */
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
    status: text("status", {
      enum: ["awaiting_payment", "rewarded", "revoked", "pending_review"],
    })
      .notNull()
      .default("awaiting_payment"),
    /** 创建关系时冻结的奖励规则快照。null = 创建时 rewards 未开启。 */
    ruleSnapshot: jsonb("rule_snapshot"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("referral_relationships_inviter_idx").on(t.inviterUserId)],
);

/** 奖励事件：每次发放或回收都有一条记录。账户删除时保留（FK set null），
 *  credit_transactions 里有对应的 source_id 可追溯。 */
export const referralRewards = pgTable(
  "referral_rewards",
  {
    id: text("id").primaryKey(),
    inviteeUserId: text("invitee_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "set null" }),
    inviterUserId: text("inviter_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "set null" }),
    /** 触发的订单 provider + orderId，格式 "{provider}:{orderId}" */
    orderRef: text("order_ref").notNull(),
    type: text("type", { enum: ["granted", "revoked"] }).notNull(),
    inviterCredits: integer("inviter_credits").notNull().default(0),
    inviteeCredits: integer("invitee_credits").notNull().default(0),
    inviterGrantSourceId: text("inviter_grant_source_id"),
    inviteeGrantSourceId: text("invitee_grant_source_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("referral_rewards_invitee_idx").on(t.inviteeUserId),
    index("referral_rewards_inviter_idx").on(t.inviterUserId),
    index("referral_rewards_order_idx").on(t.orderRef),
  ],
);

/**
 * 奖励债务：回收时余额不够扣的部分。积分余额上涨后按 FIFO 偿还。
 * 账户删除时 CASCADE：债务跟着用户走，用户删除后债权自然消失
 * （credit_transactions 里的余额记录已随 user CASCADE，债也没地方要了）。
 */
export const referralRewardDebt = pgTable(
  "referral_reward_debt",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    rewardId: text("reward_id"),
    amount: integer("amount").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (t) => [
    index("referral_reward_debt_user_idx").on(t.userId),
    index("referral_reward_debt_settled_idx").on(t.settledAt),
  ],
);
