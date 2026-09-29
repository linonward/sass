// Selling downloadable files: released versions + a grant per purchase. The switch and products
// are under downloads in site.config.ts.
//
// Business tables go in src/features/*/schema.ts — drizzle.config.ts picks them up when generating
// migrations.
import {
  bigint,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "@/core/db/schema/auth";

/**
 * One row = one released version of a product; the file is at `object_key` in private object
 * storage (R2). Written by `pnpm downloads:publish`: the file is uploaded first and the row inserted
 * after, so a row always has a file. The version is unique within a product; republishing the same
 * version overwrites the file and refreshes the size without changing the release time.
 */
export const downloadReleases = pgTable(
  "download_releases",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    productId: text("product_id").notNull(),
    version: text("version").notNull(),
    objectKey: text("object_key").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("download_releases_product_version_idx").on(
      t.productId,
      t.version,
    ),
  ],
);

/**
 * One row = the grant from one purchase.
 *
 * - (provider, order_id, product_id) is unique: replayed or re-sent webhooks never add a grant or
 *   send another email;
 * - `updates_until` = purchase time + the product's updateMonths: every version released before it
 *   can be downloaded;
 * - `revoked_at`: set when the order is fully refunded, after which no version can be downloaded
 *   (partial refunds leave it alone);
 * - `user_id` foreign key cascades: deleting the account deletes its grants.
 */
export const downloadEntitlements = pgTable(
  "download_entitlements",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    productId: text("product_id").notNull(),
    provider: text("provider").notNull(),
    orderId: text("order_id").notNull(),
    purchasedAt: timestamp("purchased_at", { withTimezone: true }).notNull(),
    updatesUntil: timestamp("updates_until", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("download_entitlements_order_idx").on(
      t.provider,
      t.orderId,
      t.productId,
    ),
    index("download_entitlements_user_idx").on(t.userId),
  ],
);

export type DownloadRelease = typeof downloadReleases.$inferSelect;
export type DownloadEntitlement = typeof downloadEntitlements.$inferSelect;
