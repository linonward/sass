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

// One code per person: randomly generated, neither containing nor derived from the user ID, so a
// code can't be traced back to an account or enumerated.
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
 * Referral relationship: the invitee is the primary key and is never changed after the first
 * write. Status starts at "awaiting first payment"; reward settlement only advances the status and
 * never changes attribution. code is kept only as a historical record, with no foreign key: when
 * the inviter deletes their account the relationship is deleted too (per the data-deletion
 * policy), and the code itself plays no part in settlement.
 *
 * rule_snapshot freezes the reward rule version: a config snapshot taken when the relationship is
 * created. Rewards are decided by it rather than the current config, so rule changes don't affect
 * existing relationships.
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
    /** Reward rule snapshot frozen at creation. null = rewards were off at creation. */
    ruleSnapshot: jsonb("rule_snapshot"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("referral_relationships_inviter_idx").on(t.inviterUserId)],
);

/**
 * Reward events: one record per grant or reclaim. Kept when the account is deleted (FK set null);
 * the matching source_id in credit_transactions makes them traceable.
 */
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
    /** The triggering order's provider + orderId, formatted "{provider}:{orderId}". */
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
 * Reward debt: the part of a reclaim the balance couldn't cover. Repaid FIFO as the credit balance
 * grows. CASCADE on account deletion: the debt follows the user, and once the user is deleted the
 * claim simply goes away (the balance records in credit_transactions already CASCADE with user, so
 * there's nothing left to collect from).
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
