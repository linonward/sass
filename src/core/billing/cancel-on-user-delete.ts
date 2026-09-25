import { and, eq, inArray } from "drizzle-orm";

import type { OnUserDeleteHandler } from "@/core/account/on-user-delete";
import type { Database } from "@/core/db";
import { subscriptions } from "@/core/db/schema";

import type { PaymentProvider } from "./provider";

/** 还会继续扣款的订阅状态。canceled 已停止续费，expired 已结束，都不用再取消。 */
const BILLABLE_STATUSES = ["active", "past_due"] as const;

/**
 * 删除账户前取消该用户在服务商那边仍会续费的订阅。
 * provider.cancelSubscription 对已取消或不存在的订阅视为成功，所以钩子可以安全重试；
 * 真实错误向上抛出，T204 会中止删除，避免账户删了还在扣费。
 * 没配置服务商（本地、CI）但用户有待取消的订阅时同样抛错，不能静默跳过。
 */
export function createCancelSubscriptionsHandler({
  db,
  provider,
}: {
  db: () => Database;
  provider: () => PaymentProvider | null;
}): OnUserDeleteHandler {
  return async ({ userId }) => {
    const current = provider();
    const rows = await db()
      .select({
        provider: subscriptions.provider,
        subscriptionId: subscriptions.providerSubscriptionId,
      })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.userId, userId),
          inArray(subscriptions.status, BILLABLE_STATUSES),
        ),
      );
    if (rows.length === 0) return;

    for (const row of rows) {
      if (!current || current.id !== row.provider) {
        throw new Error(
          `Cannot cancel ${row.provider} subscription ${row.subscriptionId}: provider not configured`,
        );
      }
      await current.cancelSubscription(row.subscriptionId);
    }
  };
}
