// Files users uploaded to R2. The object key format is <userId>/<yyyy-mm>/<uuid>.<ext>. The user_id
// foreign key cascades: deleting an account deletes its file records, but the objects in R2 aren't
// cleaned up automatically (v1 doesn't do that).
import { bigint, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";

// pending: an upload URL was issued but not yet confirmed; uploaded: the object was confirmed to
// exist, with size and type matching what was issued.
export const fileStatuses = ["pending", "uploaded"] as const;
export type FileStatus = (typeof fileStatuses)[number];

export const files = pgTable(
  "files",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    key: text("key").notNull().unique(),
    // Size in bytes. A single file can be up to 5 GiB, beyond integer range, so bigint.
    size: bigint("size", { mode: "number" }).notNull(),
    mime: text("mime").notNull(),
    status: text("status", { enum: fileStatuses }).notNull().default("pending"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("files_user_idx").on(t.userId, t.createdAt)],
);

export type FileRecord = typeof files.$inferSelect;
