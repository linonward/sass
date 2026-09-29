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

/**
 * Balance cache. The source of truth is credit_transactions; balance always equals the sum of the
 * user's transaction amounts.
 */
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
  // Last line of defense: even if the code has a bug, the balance can't go negative.
  (table) => [
    check("user_credits_balance_non_negative", sql`${table.balance} >= 0`),
  ],
);

/**
 * Credit transactions. amount is signed: positive for grant / refund, negative for deduct, either
 * for adjust. (source, source_id) is unique, so writing a transaction for the same source again has
 * no effect — this is what makes it idempotent.
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
    // The admin who made a manual adjustment (adjust). Set to null if the admin account is deleted;
    // the transaction itself is kept.
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
    // Admin metrics sum credits by time range.
    index("credit_transactions_created_idx").on(table.createdAt),
    check(
      "credit_transactions_type_valid",
      sql`${table.type} in ('grant', 'deduct', 'refund', 'adjust')`,
    ),
    check("credit_transactions_amount_non_zero", sql`${table.amount} <> 0`),
    // Sign matches type, so a bad write can't break the sum(amount) ↔ balance correspondence.
    check(
      "credit_transactions_amount_sign",
      sql`(${table.type} in ('grant', 'refund') and ${table.amount} > 0)
        or (${table.type} = 'deduct' and ${table.amount} < 0)
        or ${table.type} = 'adjust'`,
    ),
  ],
);
