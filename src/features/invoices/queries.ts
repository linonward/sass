import { and, count, desc, eq, ilike, type SQL } from "drizzle-orm";

import type { Database } from "@/core/db/client";

import { invoices } from "./schema";

// 示例业务模块的读查询：列表 + 按客户名搜索 + 分页。写法照 src/core/admin/queries.ts
// （同样的 `Promise.all` 双查询、同样的 Paged 形状），但留在这里 —— 业务模块去 import
// 后台的查询和组件是反向依赖，而示例本来就该能整块删掉。

/** 列表每页的条数。 */
export const INVOICE_PAGE_SIZE = 10;

export type Paged<T> = {
  rows: T[];
  total: number;
  page: number;
  totalPages: number;
};

/** 解析 ?page=：正整数，其他值按第 1 页。 */
export function parsePage(value: unknown): number {
  const page = Number(typeof value === "string" ? value : undefined);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

/** LIKE 的通配符按字面匹配：搜 `100%` 时不该匹配到所有行。 */
export function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

const offsetOf = (page: number) => (page - 1) * INVOICE_PAGE_SIZE;

/**
 * 一个用户的发票，按客户名搜索（不区分大小写），最新的在前。
 *
 * `user_id` 永远在 where 里 —— 发票 id 全局唯一，少了这个条件就能翻到别人的数据。
 * 行和总数一次并发发出（第二页之后总数不会变，但两条 SQL 形状一样，没必要缓存）。
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
