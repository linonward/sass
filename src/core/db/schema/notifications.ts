import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

/**
 * Sent notifications, for deduplication: (kind, key) is unique and last_sent_at records the most
 * recent send. For example, credits-low is keyed by user and sent at most once per 24 hours;
 * subscription-canceled is keyed by subscription and sent only once. Cascades on user deletion.
 */
export const notificationLog = pgTable(
  "notification_log",
  {
    kind: text("kind").notNull(),
    key: text("key").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    lastSentAt: timestamp("last_sent_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.kind, table.key] })],
);

/**
 * Outbox status: pending is waiting to send (or for the next retry), sending is in flight (claimed
 * by some process), sent went out, and failed is a terminal failure (retries exhausted,
 * verification code expired, or superseded by a newer code) — kept so it can be resent manually.
 */
export const pendingNotificationStatuses = [
  "pending",
  "sending",
  "sent",
  "failed",
] as const;
export type PendingNotificationStatus =
  (typeof pendingNotificationStatuses)[number];

/**
 * Outbox for transactional email: critical emails first write a row inside the business
 * transaction and try to send right after commit. If sending fails the row stays here and the
 * recovery sweep resends it with backoff (see src/core/email/outbox.ts).
 *
 * - `kind` / `key`: the same pair as the notification_log dedup slot (verification codes have no
 *   dedup slot; there `key` is used to find the previous unsent code for the same email and
 *   invalidate it).
 * - `claimed_at`: when the dedup slot was claimed; on terminal failure the slot is released by it
 *   (same column type as notification_log, so comparisons encode identically). Null for emails
 *   without a slot.
 * - `props`: template parameters. Sensitive content such as verification codes is stored encrypted
 *   (`{ "enc": "..." }`) and cleared once sent or invalidated.
 * - `expires_at`: not sent after expiry (an expired verification code is useless once delivered).
 */
export const pendingNotifications = pgTable(
  "pending_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    key: text("key").notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    to: text("to").notNull(),
    template: text("template").notNull(),
    props: jsonb("props").$type<Record<string, unknown>>().notNull(),
    locale: text("locale").notNull(),
    status: text("status", { enum: pendingNotificationStatuses })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    claimedAt: timestamp("claimed_at"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // The sweep only looks for rows waiting to send; the partial index holds only pending /
    // sending and is nearly empty under normal conditions.
    index("pending_notifications_due_idx")
      .on(table.nextRetryAt)
      .where(sql`${table.status} in ('pending', 'sending')`),
    index("pending_notifications_kind_key_idx").on(table.kind, table.key),
    check(
      "pending_notifications_status_valid",
      sql`${table.status} in ('pending', 'sending', 'sent', 'failed')`,
    ),
  ],
);

export type PendingNotification = typeof pendingNotifications.$inferSelect;
