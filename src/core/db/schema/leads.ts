import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { Attribution } from "@/core/acquisition/context";
import { user } from "./auth";
export const leads = pgTable(
  "acquisition_leads",
  {
    id: text("id").primaryKey(),
    listId: text("list_id").notNull(),
    email: text("email"),
    status: text("status", { enum: ["pending", "confirmed", "withdrawn"] })
      .notNull()
      .default("pending"),
    consentText: text("consent_text"),
    consentVersion: text("consent_version"),
    consentAt: timestamp("consent_at", { withTimezone: true }),
    snapshot: jsonb("snapshot").$type<Attribution>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    confirmHash: text("confirm_hash"),
    confirmExpiresAt: timestamp("confirm_expires_at", { withTimezone: true }),
    withdrawHash: text("withdraw_hash"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    linkedAt: timestamp("linked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("leads_list_email_idx").on(t.listId, t.email),
    uniqueIndex("leads_confirm_hash_idx").on(t.confirmHash),
    uniqueIndex("leads_withdraw_hash_idx").on(t.withdrawHash),
    index("leads_expiry_idx").on(t.status, t.expiresAt),
    index("leads_email_idx").on(t.email),
  ],
);
