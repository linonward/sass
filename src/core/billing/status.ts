import { and, desc, eq, gte, inArray } from "drizzle-orm";

import type { Database } from "@/core/db";
import { orders, subscriptions } from "@/core/db/schema";

export type CheckoutStatus =
  | { status: "pending" }
  | { status: "complete"; planId: string | null }
  | { status: "failed"; planId: string | null };

const PAID = ["paid", "partially_refunded", "refunded"] as const;

/**
 * 结账回跳后查询付款是否已经入账（webhook 可能还没到）。只查这个用户自己的记录，
 * 所以回跳参数被篡改也拿不到别人的数据。
 * - 订阅：该订阅已有一笔付款成功的订单才算完成（积分和订单在同一个事务里写入），扣款失败算 failed。
 * - 一次性购买：订单已付款算完成，失败算 failed。
 * - 都还没有记录：pending。
 */
/** 兜底定位的时间回拨：下单时间取自服务器，订单写入时间取自数据库，留一点余量。 */
const SINCE_SLACK_MS = 60 * 1000;

export async function getCheckoutStatus({
  db,
  userId,
  subscriptionId,
  orderId,
  planId,
  since,
}: {
  db: Database;
  userId: string;
  subscriptionId?: string | null;
  orderId?: string | null;
  /**
   * 兜底定位（服务商回跳不带 ID 时）：这个套餐、这个时间之后这个用户的最新订单。
   * 一次性购买和订阅每一期都会写一张订单，所以两种套餐都能判断。
   */
  planId?: string | null;
  since?: Date | null;
}): Promise<CheckoutStatus> {
  if (subscriptionId) {
    // 两个查询都以 (userId, providerSubscriptionId) 为键、互不依赖，并行发出：
    // 成功页轮询会反复调用这里，串行会让每次轮询多等一跳。
    // 优先级仍是「已付款订单 > 订阅欠费」。
    const [[paid], [subscription]] = await Promise.all([
      db
        .select({ planId: orders.planId })
        .from(orders)
        .where(
          and(
            eq(orders.userId, userId),
            eq(orders.providerSubscriptionId, subscriptionId),
            inArray(orders.status, PAID),
          ),
        )
        .limit(1),
      db
        .select({ planId: subscriptions.planId, status: subscriptions.status })
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.userId, userId),
            eq(subscriptions.providerSubscriptionId, subscriptionId),
          ),
        )
        .limit(1),
    ]);
    if (paid) return { status: "complete", planId: paid.planId };

    if (subscription?.status === "past_due") {
      return { status: "failed", planId: subscription.planId };
    }
    return { status: "pending" };
  }

  if (orderId) {
    const [order] = await db
      .select({ planId: orders.planId, status: orders.status })
      .from(orders)
      .where(
        and(eq(orders.userId, userId), eq(orders.providerOrderId, orderId)),
      )
      .limit(1);
    if (!order) return { status: "pending" };
    return order.status === "failed"
      ? { status: "failed", planId: order.planId }
      : { status: "complete", planId: order.planId };
  }

  if (planId && since) {
    const [order] = await db
      .select({ planId: orders.planId, status: orders.status })
      .from(orders)
      .where(
        and(
          eq(orders.userId, userId),
          eq(orders.planId, planId),
          gte(orders.createdAt, new Date(since.getTime() - SINCE_SLACK_MS)),
        ),
      )
      .orderBy(desc(orders.createdAt))
      .limit(1);
    if (!order) return { status: "pending" };
    return order.status === "failed"
      ? { status: "failed", planId: order.planId }
      : { status: "complete", planId: order.planId };
  }

  return { status: "pending" };
}
