import { and, count, desc, eq, ilike, type SQL } from "drizzle-orm";

import type { Database, DbTransaction } from "@/core/db/client";
import { leads, user } from "@/core/db/schema";

import { ADMIN_PAGE_SIZE } from "./index";

export type LeadStatus = "pending" | "confirmed" | "withdrawn";
export const leadStatuses: readonly LeadStatus[] = [
  "pending",
  "confirmed",
  "withdrawn",
];

export type LeadRow = {
  id: string;
  email: string | null;
  status: LeadStatus;
  listId: string;
  source: string | null;
  createdAt: Date;
  confirmedAt: Date | null;
  userId: string | null;
  userEmail: string | null;
};

export type Paged<T> = {
  rows: T[];
  total: number;
  page: number;
  totalPages: number;
};

function paged<T>(rows: T[], total: number, page: number): Paged<T> {
  return {
    rows,
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE)),
  };
}

const offsetOf = (page: number) => (page - 1) * ADMIN_PAGE_SIZE;

/** LIKE 的通配符按字面匹配。 */
function likePattern(query: string) {
  return `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** 解析状态筛选：不在取值范围内时视为不筛选。 */
export function parseLeadStatus(value: unknown): LeadStatus | undefined {
  return leadStatuses.includes(value as LeadStatus)
    ? (value as LeadStatus)
    : undefined;
}

/** 线索列表：支持状态筛选和邮箱搜索，最新创建的在前。 */
export async function listLeads(
  db: Database,
  {
    status,
    email,
    page = 1,
  }: { status?: LeadStatus; email?: string; page?: number },
): Promise<Paged<LeadRow>> {
  const clauses: SQL[] = [];
  if (status) clauses.push(eq(leads.status, status));
  if (email && email.trim()) {
    const q = email.trim();
    clauses.push(ilike(leads.email, likePattern(q)));
  }
  const where: SQL | undefined =
    clauses.length > 0 ? and(...clauses) : undefined;

  const [rows, [counted]] = await Promise.all([
    db
      .select({
        id: leads.id,
        email: leads.email,
        status: leads.status,
        listId: leads.listId,
        snapshot: leads.snapshot,
        createdAt: leads.createdAt,
        confirmedAt: leads.confirmedAt,
        userId: leads.userId,
        userEmail: user.email,
      })
      .from(leads)
      .leftJoin(user, eq(user.id, leads.userId))
      .where(where)
      .orderBy(desc(leads.createdAt), desc(leads.id))
      .limit(ADMIN_PAGE_SIZE)
      .offset(offsetOf(page)),
    db.select({ total: count() }).from(leads).where(where),
  ]);

  const mapped: LeadRow[] = rows.map((r) => {
    const snap = r.snapshot as Record<string, unknown> | null;
    return {
      id: r.id,
      email: r.email,
      status: r.status as LeadStatus,
      listId: r.listId,
      source: snap?.source ? String(snap.source) : null,
      createdAt: r.createdAt,
      confirmedAt: r.confirmedAt,
      userId: r.userId,
      userEmail: r.userEmail,
    };
  });

  return paged(mapped, counted?.total ?? 0, page);
}

/** 删除一条线索。仅限管理员调用，权限由调用方保证。 */
export async function deleteLead(db: Database | DbTransaction, leadId: string) {
  const [deleted] = await db
    .delete(leads)
    .where(eq(leads.id, leadId))
    .returning({ id: leads.id });
  return deleted ?? null;
}

/** CSV 导出用：不加分页，最多 MAX_EXPORT_ROWS 行。 */
const MAX_EXPORT_ROWS = 10_000;

export type LeadExportRow = {
  email: string | null;
  status: string;
  listId: string;
  source: string | null;
  sourceDetails: string | null;
  createdAt: string;
  confirmedAt: string | null;
  userEmail: string | null;
};

export async function getLeadExportData(
  db: Database,
  { status, email }: { status?: LeadStatus; email?: string },
): Promise<{ rows: LeadExportRow[]; total: number; truncated: boolean }> {
  const clauses: SQL[] = [];
  if (status) clauses.push(eq(leads.status, status));
  if (email && email.trim()) {
    clauses.push(ilike(leads.email, likePattern(email.trim())));
  }
  const where: SQL | undefined =
    clauses.length > 0 ? and(...clauses) : undefined;

  const [[counted], rows] = await Promise.all([
    db.select({ total: count() }).from(leads).where(where),
    db
      .select({
        email: leads.email,
        status: leads.status,
        listId: leads.listId,
        snapshot: leads.snapshot,
        createdAt: leads.createdAt,
        confirmedAt: leads.confirmedAt,
        userEmail: user.email,
      })
      .from(leads)
      .leftJoin(user, eq(user.id, leads.userId))
      .where(where)
      .orderBy(desc(leads.createdAt), desc(leads.id))
      .limit(MAX_EXPORT_ROWS + 1),
  ]);

  const total = counted?.total ?? 0;
  const truncated = rows.length > MAX_EXPORT_ROWS;
  const exportRows: LeadExportRow[] = rows
    .slice(0, MAX_EXPORT_ROWS)
    .map((r) => {
      const snap = r.snapshot as Record<string, unknown> | null;
      return {
        email: r.email,
        status: r.status,
        listId: r.listId,
        source: snap?.source ? String(snap.source) : null,
        sourceDetails: snap
          ? [
              snap.referrerHost,
              snap.utm_medium,
              snap.utm_campaign,
              snap.utm_term,
              snap.utm_content,
            ]
              .filter(Boolean)
              .join(" | ") || null
          : null,
        createdAt: r.createdAt.toISOString(),
        confirmedAt: r.confirmedAt?.toISOString() ?? null,
        userEmail: r.userEmail,
      };
    });

  return { rows: exportRows, total, truncated };
}
