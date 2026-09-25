import { and, desc, eq, gt, inArray, isNull, or } from "drizzle-orm";

import type { Database } from "@/core/db";
import { billingCustomers, orders, subscriptions } from "@/core/db/schema";
import type { SubscriptionStatus } from "@/core/db/schema";

export type BillingOverview = {
  /** 仍在使用中的订阅：active、past_due，或已取消续费但还没到期。 */
  subscription: {
    planId: string | null;
    status: SubscriptionStatus;
    currentPeriodEnd: Date | null;
    canceledAt: Date | null;
  } | null;
  /** 已付款的一次性套餐。 */
  purchasedPlanIds: string[];
  /** 是否在服务商那边有客户记录（有才能打开客户门户）。 */
  hasCustomer: boolean;
};

/** 账单页和定价页用到的当前状态。 */
export async function getBillingOverview({
  db,
  userId,
  now = new Date(),
}: {
  db: Database;
  userId: string;
  now?: Date;
}): Promise<BillingOverview> {
  const [subscription] = await db
    .select({
      planId: subscriptions.planId,
      status: subscriptions.status,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      canceledAt: subscriptions.canceledAt,
    })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        or(
          inArray(subscriptions.status, ["active", "past_due"]),
          and(
            eq(subscriptions.status, "canceled"),
            gt(subscriptions.currentPeriodEnd, now),
          ),
        ),
      ),
    )
    .orderBy(desc(subscriptions.lastEventAt))
    .limit(1);

  const purchases = await db
    .selectDistinct({ planId: orders.planId })
    .from(orders)
    .where(
      and(
        eq(orders.userId, userId),
        eq(orders.status, "paid"),
        isNull(orders.providerSubscriptionId),
      ),
    );

  const [customer] = await db
    .select({ id: billingCustomers.id })
    .from(billingCustomers)
    .where(eq(billingCustomers.userId, userId))
    .limit(1);

  return {
    subscription: subscription ?? null,
    purchasedPlanIds: purchases
      .map((p) => p.planId)
      .filter((id): id is string => Boolean(id)),
    hasCustomer: Boolean(customer),
  };
}

/** 定价页按钮的状态：已订阅的套餐显示"管理订阅"，买过的一次性套餐显示"已购买"。 */
export function ownedPlans(overview: BillingOverview) {
  const owned: Record<string, "subscribed" | "purchased"> = {};
  for (const id of overview.purchasedPlanIds) owned[id] = "purchased";
  if (overview.subscription?.planId) {
    owned[overview.subscription.planId] = "subscribed";
  }
  return owned;
}
