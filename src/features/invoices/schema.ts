// 示例业务模块：发票 CRUD（delete me —— 删除步骤见文件末尾）。
//
// 这是给买家抄的第二个示例：怎么用 Drizzle 表 + RSC 列表 + Server Actions 做一个
// 完整的 CRUD（列表、分页、搜索、新建、编辑、删除确认）。只在需要 Postgres 这一点上
// 有依赖，其余零配置；不需要它时整个模块可以干净地删掉（清单写在文件末尾）。
//
// 业务的表放 src/features/*/schema.ts —— drizzle.config.ts 会把这里一并收录生成迁移，
// 不需要在 src/core/db/schema/index.ts 里登记。
import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "@/core/db/schema/auth";

/** 发票状态。和其它模块一样用共享的 `as const` 数组，列上用 `enum` 收口。 */
export const invoiceStatuses = ["draft", "sent", "paid", "void"] as const;
export type InvoiceStatus = (typeof invoiceStatuses)[number];

/**
 * 一行 = 一张发票。
 *
 * - `user_id` 是外键（cascade）：删除账户时发票一并删除；
 * - `amount` 是最小货币单位（分），整数存钱不用浮点；展示时按
 *   `site.config.ts` 的 `billing.currency` 格式化；
 * - 所有读写都带 `user_id` 条件（见 ./queries.ts / ./actions.ts）：主键全局唯一，
 *   只按 id 查就会拿到别人的发票。
 */
export const invoices = pgTable(
  "invoices",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    customerName: text("customer_name").notNull(),
    amount: integer("amount").notNull(),
    status: text("status", { enum: invoiceStatuses })
      .notNull()
      .default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    // 列表页的查询就是「按用户 + 按时间倒序」，一条组合索引够用。
    index("invoices_user_created_idx").on(t.userId, t.createdAt),
  ],
);

export type InvoiceRecord = typeof invoices.$inferSelect;

// 删除这个示例时，连同下面这些一起删：
//   1. src/features/invoices/ 整个目录（本文件、queries.ts、actions.ts、dialogs.tsx、
//      page.tsx 和三个测试）；
//   2. src/app/[locale]/(app)/invoices/ 路由目录；
//   3. site.config.ts 里 features 下的 examples，以及 src/core/config/schema.ts 里的
//      examplesSchema 和 dashboardIcons 里的 receipt；
//   4. src/core/auth/routes.ts 里 moduleGatedPages 的 "/invoices"；
//   5. src/core/dashboard/nav.ts 里的 invoicesNav（和 dashboardNav 里的那一段展开）；
//   6. messages/{en,zh}.json 里的 Invoices、Dashboard.nav.invoices，以及
//      src/core/i18n/client-messages.ts 的 clientNamespaces 里的 "Invoices"；
//   7. e2e/invoices.spec.ts、e2e/invoices/ 子套件、根 playwright.config.ts 两个
//      testIgnore 里的 "invoices/**"、package.json 的 test:e2e:invoices
//      和 .github/workflows/ci.yml 里对应的那一步；
//   8. invoices 表：已经上线的库要自己写一条 drop 迁移（不要改历史迁移文件）。
