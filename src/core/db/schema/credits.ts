import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

export const creditTransactionTypes = [
  "grant",
  "deduct",
  "refund",
  "adjust",
] as const;
export type CreditTransactionType = (typeof creditTransactionTypes)[number];

/** 余额缓存。真实来源是 credit_transactions，balance 恒等于该用户流水 amount 之和。 */
export const userCredits = pgTable(
  "user_credits",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    balance: integer("balance").notNull().default(0),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  // 最后一道防线：即使代码有误，余额也不会变成负数。
  (table) => [
    check("user_credits_balance_non_negative", sql`${table.balance} >= 0`),
  ],
);

/**
 * 积分流水。amount 带符号：grant / refund 为正，deduct 为负，adjust 可正可负。
 * (source, source_id) 唯一，重复写入同一来源的流水不生效，用于幂等。
 */
export const creditTransactions = pgTable(
  "credit_transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text("type").$type<CreditTransactionType>().notNull(),
    amount: integer("amount").notNull(),
    reason: text("reason"),
    source: text("source").notNull(),
    sourceId: text("source_id").notNull(),
    // 手动调整（adjust）时操作的管理员。管理员账户删除后置空，流水本身保留。
    actorId: text("actor_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("credit_transactions_source_unique").on(
      table.source,
      table.sourceId,
    ),
    index("credit_transactions_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
    // 后台指标按时间区间统计积分。
    index("credit_transactions_created_idx").on(table.createdAt),
    check(
      "credit_transactions_type_valid",
      sql`${table.type} in ('grant', 'deduct', 'refund', 'adjust')`,
    ),
    check("credit_transactions_amount_non_zero", sql`${table.amount} <> 0`),
    // 符号与类型一致，保证 sum(amount) 与余额的对应关系不被错误写入破坏。
    check(
      "credit_transactions_amount_sign",
      sql`(${table.type} in ('grant', 'refund') and ${table.amount} > 0)
        or (${table.type} = 'deduct' and ${table.amount} < 0)
        or ${table.type} = 'adjust'`,
    ),
  ],
);
