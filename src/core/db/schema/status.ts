import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const statusEventStatuses = [
  "operational",
  "degraded",
  "outage",
] as const;
export type StatusEventStatus = (typeof statusEventStatuses)[number];

/** Event origin: opened by an admin in the admin panel, or detected by an auto-mode probe. */
export const statusEventSources = ["manual", "auto"] as const;
export type StatusEventSource = (typeof statusEventSources)[number];

/**
 * One incident / announcement on the status page. One row each; `resolvedAt` null means it's still
 * ongoing.
 *
 * - `component` is a key of `statusPage.components` in `site.config.ts`; removing the component
 *   from the config later doesn't affect history (display falls back to the key itself).
 * - Rows with `status` `operational` are for "no impact" announcements; they don't pull the
 *   overall status into an abnormal state.
 * - `notifiedAt` is when subscribers were last notified; creates / updates within 5 minutes are
 *   merged into one email (see `src/core/status/notify.ts`).
 */
export const statusEvents = pgTable(
  "status_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    component: text("component").notNull(),
    status: text("status", { enum: statusEventStatuses }).notNull(),
    message: text("message").notNull(),
    source: text("source", { enum: statusEventSources })
      .notNull()
      .default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
  },
  (table) => [
    // Fetch a component's latest event, and compute uptime per window.
    index("status_events_component_idx").on(table.component, table.createdAt),
    // Find events that are still ongoing.
    index("status_events_open_idx").on(table.component, table.resolvedAt),
  ],
);

/**
 * Probe state for auto mode, one row per component. It exists so that "degraded" needs two
 * consecutive failures: a single failed probe may just be network jitter and shouldn't immediately
 * pull the overall status into an abnormal state.
 */
export const statusChecks = pgTable("status_checks", {
  component: text("component").primaryKey(),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }).notNull(),
  lastOk: boolean("last_ok"),
  /** Reason for the latest failure, written into the auto-created incident for debugging. */
  lastError: text("last_error"),
});

/**
 * Email subscribers to the status page. Only counts as subscribed after double opt-in (a
 * confirmation email); unconfirmed rows can be overwritten by a new subscription once expired.
 *
 * No `userId`: subscribing is unrelated to signing in, so notification_log isn't reused (its
 * user_id is a foreign key). There's no unsubscribe-token column either: the unsubscribe link is a
 * signature over "address + site secret", so the server doesn't need to store anything (see
 * status/subscribers.ts).
 */
export const statusSubscribers = pgTable(
  "status_subscribers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    /** Locale at subscription time; notifications render their copy in it. */
    locale: text("locale"),
    confirmHash: text("confirm_hash"),
    confirmExpiresAt: timestamp("confirm_expires_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // One row per address; the confirmation token hash is unique, so lookups don't scan the table.
    uniqueIndex("status_subscribers_email_idx").on(table.email),
    uniqueIndex("status_subscribers_confirm_hash_idx").on(table.confirmHash),
  ],
);
