// 卖可下载文件：发布的版本 + 每笔购买的授权。开关与产品在 site.config.ts 的 downloads。
//
// 业务的表放 src/features/*/schema.ts —— drizzle.config.ts 会一并收录生成迁移。
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
 * 一行 = 某个产品的一个发布版本，文件在私有对象存储（R2）的 `object_key`。
 * 由 `pnpm downloads:publish` 写入：先上传文件，再插这一行，所以有行就一定有文件。
 * 版本号在同一产品内唯一；重发同一版本是覆盖文件、刷新大小，不改发布时间。
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
 * 一行 = 一笔购买换来的授权。
 *
 * - (provider, order_id, product_id) 唯一：webhook 重放、补发都不会多出授权或多发邮件；
 * - `updates_until` = 购买时间 + 产品的 updateMonths：在它之前发布的版本都能下；
 * - `revoked_at`：订单全额退款时置上，之后一个版本都下不了（部分退款不动）；
 * - `user_id` 外键 cascade：删除账户时授权一并删除。
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
