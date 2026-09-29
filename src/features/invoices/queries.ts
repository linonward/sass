import { and, count, desc, eq, ilike, type SQL } from "drizzle-orm";

import type { Database } from "@/core/db/client";

import { invoices } from "./schema";

// Read queries for the example business module: list + search by customer name + pagination.
// Modeled on src/core/admin/queries.ts (the same `Promise.all` pair of queries, the same Paged
// shape) but kept here — a business module importing admin queries and components would be a
// reversed dependency, and the example should be deletable as a whole.

/** Rows per list page. */
export const INVOICE_PAGE_SIZE = 10;

export type Paged<T> = {
  rows: T[];
  total: number;
  page: number;
  totalPages: number;
};

/** LIKE wildcards are matched literally: searching for `100%` must not match every row. */
export function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

const offsetOf = (page: number) => (page - 1) * INVOICE_PAGE_SIZE;

/**
 * A user's invoices, searchable by customer name (case-insensitive), newest first.
 *
 * `user_id` is always in the where clause — invoice ids are globally unique, so without it you
 * could page through someone else's data. Rows and total are fetched concurrently (the total
 * doesn't change after page two, but both queries have the same shape, so caching isn't worth it).
 */
export async function listInvoices(
  db: Database,
  {
    userId,
    query = "",
    page = 1,
  }: { userId: string; query?: string; page?: number },
) {
  const q = query.trim();
  const where: SQL = q
    ? and(
        eq(invoices.userId, userId),
        ilike(invoices.customerName, likePattern(q)),
      )!
    : eq(invoices.userId, userId);
  const [rows, [counted]] = await Promise.all([
    db
      .select()
      .from(invoices)
      .where(where)
      .orderBy(desc(invoices.createdAt), desc(invoices.id))
      .limit(INVOICE_PAGE_SIZE)
      .offset(offsetOf(page)),
    db.select({ total: count() }).from(invoices).where(where),
  ]);
  const total = counted?.total ?? 0;
  return {
    rows,
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / INVOICE_PAGE_SIZE)),
  } satisfies Paged<InvoiceRow>;
}

export type InvoiceRow = typeof invoices.$inferSelect;
