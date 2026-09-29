// Users' own API keys. The plaintext is returned only once, at creation; the database stores only
// the SHA-256 hash. The user_id foreign key cascades: deleting an account deletes its keys too.
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

/**
 * One row = one key.
 *
 * - `prefix`: the first 10 characters of the plaintext (`sk_` + 8), only for telling keys apart
 *   in the UI; not enough on its own to recover the full plaintext.
 * - `hashedKey`: SHA-256 (hex) of the full plaintext, used for lookup during auth; neither the
 *   plaintext nor a reversible encryption is stored.
 * - `revokedAt` null means active; revoking writes this column rather than deleting the row (keeps
 *   history).
 * - `expiresAt` null means it never expires; after expiry, auth treats the key as invalid.
 */
export const userApiKeys = pgTable(
  "user_api_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Name chosen by the user, unique per user (duplicate names would make keys indistinguishable
    // in the list).
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    hashedKey: text("hashed_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    // Last time the key passed auth; null means never used.
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("user_api_keys_user_name_idx").on(t.userId, t.name),
    // The only lookup condition on the auth path.
    index("user_api_keys_hashed_key_idx").on(t.hashedKey),
  ],
);

export type UserApiKeyRecord = typeof userApiKeys.$inferSelect;
