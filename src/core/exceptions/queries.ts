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

/**
 * Exception list: filterable by kind and status; open ones first, then newest first. Each row
 * includes its handling history.
 */
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
        // The admin account may have been deleted: the audit entry still shows, just without an
        // email.
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

/** Number of open exceptions (the count shown in the sidebar). */
export async function countOpenExceptions(db: Database) {
  const [row] = await db
    .select({ total: count() })
    .from(billingExceptions)
    .where(eq(billingExceptions.status, "open"));
  return row?.total ?? 0;
}
