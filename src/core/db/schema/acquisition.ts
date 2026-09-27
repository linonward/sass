import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { Attribution } from "@/core/acquisition/context";
import { leads } from "./leads";
import { user } from "./auth";

// Missing row = unknown (including pre-feature users). A null snapshot is a
// withdrawal tombstone: replaying a registration retry must not restore it.
export const userAttribution = pgTable("user_attribution", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  leadId: text("lead_id").references(() => leads.id, { onDelete: "set null" }),
  snapshot: jsonb("snapshot").$type<Attribution>(),
  registeredAt: timestamp("registered_at", { withTimezone: true }).notNull(),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
});
