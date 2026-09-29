import { and, eq, sql } from "drizzle-orm";

import type { Database, DbTransaction } from "@/core/db/client";
import { billingExceptions, type BillingExceptionKind } from "@/core/db/schema";

export type OpenExceptionInput = {
  kind: BillingExceptionKind;
  userId: string;
  source: string;
  sourceId: string;
  detail: Record<string, unknown>;
  lastError?: string;
  /**
   * When the same exception already exists: `false` (default) touches nothing — a webhook replay
   * can't open a second one or change the existing one; `true` increments `attempts` and updates
   * `lastError` / `detail` while the exception is still open (a sweep that keeps failing to reach a
   * conclusion). An exception that has already been handled (resolved / ignored) is never reopened
   * in either case.
   */
  bump?: boolean;
};

/**
 * Opens an exception, or updates the existing one according to `bump`. The unique key is
 * `(kind, source, source_id)`. When given a transaction it writes inside it, so it commits or rolls
 * back together with the money movement that triggered it.
 */
export async function openException(
  executor: Database | DbTransaction,
  {
    kind,
    userId,
    source,
    sourceId,
    detail,
    lastError,
    bump = false,
  }: OpenExceptionInput,
) {
  const insert = executor.insert(billingExceptions).values({
    kind,
    userId,
    source,
    sourceId,
    detail,
    lastError: lastError ?? null,
    attempts: lastError ? 1 : 0,
  });
  if (!bump) {
    await insert.onConflictDoNothing({
      target: [
        billingExceptions.kind,
        billingExceptions.source,
        billingExceptions.sourceId,
      ],
    });
    return;
  }
  await insert.onConflictDoUpdate({
    target: [
      billingExceptions.kind,
      billingExceptions.source,
      billingExceptions.sourceId,
    ],
    set: {
      attempts: sql`${billingExceptions.attempts} + 1`,
      lastError: lastError ?? null,
      detail: sql`${billingExceptions.detail} || excluded.detail`,
      updatedAt: sql`now()`,
    },
    setWhere: and(eq(billingExceptions.status, "open")),
  });
}
