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
   * 同一张单已经存在时：`false`（默认）什么都不动 —— webhook 重放开不出第二张，也不改已有内容；
   * `true` 在单子仍是 open 时累加 `attempts` 并更新 `lastError` / `detail`（扫描反复查不到结论）。
   * 已经处理掉（resolved / ignored）的单子两种情况下都不会被重新打开。
   */
  bump?: boolean;
};

/**
 * 开一张异常单，或者按 `bump` 更新已有的那张。唯一键是 `(kind, source, source_id)`。
 * 传入事务时在事务内写：和触发它的那笔钱一起提交或一起回滚。
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
