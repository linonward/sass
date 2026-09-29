import { and, asc, count, desc, eq, inArray, sql, type SQL } from "drizzle-orm";

import type { Database } from "@/core/db/client";
import {
  adminActions,
  billingExceptionKinds,
  billingExceptions,
  billingExceptionStatuses,
  user,
  type BillingExceptionKind,
  type BillingExceptionStatus,
} from "@/core/db/schema";

import { EXCEPTION_TARGET } from "./service";

export const EXCEPTIONS_PAGE_SIZE = 20;

export const parseExceptionStatus = (value: unknown) =>
  billingExceptionStatuses.includes(value as BillingExceptionStatus)
    ? (value as BillingExceptionStatus)
    : undefined;

export const parseExceptionKind = (value: unknown) =>
  billingExceptionKinds.includes(value as BillingExceptionKind)
    ? (value as BillingExceptionKind)
    : undefined;

/** 异常单列表：可按种类、状态筛选；open 的排在前面，其次新的在前。每行带上处理历史。 */
export async function listExceptions(
  db: Database,
  {
    kind,
    status,
    page = 1,
  }: {
    kind?: BillingExceptionKind;
    status?: BillingExceptionStatus;
    page?: number;
  },
) {
  const where: SQL | undefined = and(
    kind ? eq(billingExceptions.kind, kind) : undefined,
    status ? eq(billingExceptions.status, status) : undefined,
  );
  const [rows, [counted]] = await Promise.all([
    db
      .select({
        id: billingExceptions.id,
        kind: billingExceptions.kind,
        status: billingExceptions.status,
        userId: billingExceptions.userId,
        email: user.email,
        source: billingExceptions.source,
        sourceId: billingExceptions.sourceId,
        detail: billingExceptions.detail,
        attempts: billingExceptions.attempts,
        lastError: billingExceptions.lastError,
        resolution: billingExceptions.resolution,
        createdAt: billingExceptions.createdAt,
        resolvedAt: billingExceptions.resolvedAt,
      })
      .from(billingExceptions)
      .innerJoin(user, eq(user.id, billingExceptions.userId))
      .where(where)
      .orderBy(
        sql`(${billingExceptions.status} = 'open') desc`,
        desc(billingExceptions.createdAt),
        desc(billingExceptions.id),
      )
      .limit(EXCEPTIONS_PAGE_SIZE)
      .offset((page - 1) * EXCEPTIONS_PAGE_SIZE),
    db.select({ total: count() }).from(billingExceptions).where(where),
  ]);

  const history = rows.length
    ? await db
        .select({
          id: adminActions.id,
          targetId: adminActions.targetId,
          actorId: adminActions.actorId,
          actorEmail: user.email,
          action: adminActions.action,
          reason: adminActions.reason,
          result: adminActions.result,
          createdAt: adminActions.createdAt,
        })
        .from(adminActions)
        // 管理员账号可能已经删了：审计照样显示，只是没有邮箱。
        .leftJoin(user, eq(user.id, adminActions.actorId))
        .where(
          and(
            eq(adminActions.targetKind, EXCEPTION_TARGET),
            inArray(
              adminActions.targetId,
              rows.map((row) => row.id),
            ),
          ),
        )
        .orderBy(asc(adminActions.createdAt))
    : [];

  const total = counted?.total ?? 0;
  return {
    rows: rows.map((row) => ({
      ...row,
      history: history.filter((entry) => entry.targetId === row.id),
    })),
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / EXCEPTIONS_PAGE_SIZE)),
  };
}

export type ExceptionRow = Awaited<
  ReturnType<typeof listExceptions>
>["rows"][number];

/** 待处理的异常单数量（侧边栏上的计数）。 */
export async function countOpenExceptions(db: Database) {
  const [row] = await db
    .select({ total: count() })
    .from(billingExceptions)
    .where(eq(billingExceptions.status, "open"));
  return row?.total ?? 0;
}
