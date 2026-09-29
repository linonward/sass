// Example business module: invoice CRUD (delete me — removal steps at the end of this file).
//
// This is the second example for buyers to copy: how to build complete CRUD (list, pagination,
// search, create, edit, delete confirmation) with a Drizzle table + an RSC list + Server Actions.
// Its only dependency is Postgres, otherwise zero config; if you don't need it, the whole module
// deletes cleanly (checklist at the end of this file).
//
// Business tables go in src/features/*/schema.ts — drizzle.config.ts picks them up when generating
// migrations, with no need to register them in src/core/db/schema/index.ts.
import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "@/core/db/schema/auth";

/** Invoice statuses. Like other modules, a shared `as const` array, constrained on the column with `enum`. */
export const invoiceStatuses = ["draft", "sent", "paid", "void"] as const;
export type InvoiceStatus = (typeof invoiceStatuses)[number];

/**
 * One row = one invoice.
 *
 * - `user_id` is a foreign key (cascade): deleting the account deletes its invoices;
 * - `amount` is in minor currency units (cents) — money is stored as integers, never floats — and
 *   formatted with `billing.currency` from `site.config.ts` for display;
 * - every read and write is scoped by `user_id` (see ./queries.ts / ./actions.ts): the primary key
 *   is globally unique, so querying by id alone would return other people's invoices.
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
    // The list page query is "by user, newest first", so one composite index is enough.
    index("invoices_user_created_idx").on(t.userId, t.createdAt),
  ],
);

export type InvoiceRecord = typeof invoices.$inferSelect;

// When deleting this example, also delete:
//   1. the whole src/features/invoices/ directory (this file, queries.ts, actions.ts, dialogs.tsx,
//      page.tsx and the three tests);
//   2. the src/app/[locale]/(app)/invoices/ route directory;
//   3. examples under features in site.config.ts, plus examplesSchema and the receipt entry in
//      dashboardIcons in src/core/config/schema.ts;
//   4. "/invoices" in moduleGatedPages in src/core/auth/routes.ts;
//   5. invoicesNav in src/core/dashboard/nav.ts (and the spread of it in dashboardNav);
//   6. Invoices and Dashboard.nav.invoices in messages/{en,zh}.json, plus "Invoices" in
//      clientNamespaces in src/core/i18n/client-messages.ts;
//   7. e2e/invoices.spec.ts, the e2e/invoices/ sub-suite, "invoices/**" in both testIgnore
//      entries of the root playwright.config.ts, test:e2e:invoices in package.json, and the
//      matching step in .github/workflows/ci.yml;
//   8. the invoices table: for a database already in production, write your own drop migration
//      (don't edit past migration files).
