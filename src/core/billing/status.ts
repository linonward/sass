import { and, desc, eq, gte, inArray } from "drizzle-orm";

import type { Database } from "@/core/db";
import { orders, subscriptions } from "@/core/db/schema";

export type CheckoutStatus =
  | { status: "pending" }
  | { status: "complete"; planId: string | null }
  | { status: "failed"; planId: string | null };

const PAID = ["paid", "partially_refunded", "refunded"] as const;

/**
 * After the checkout redirect, check whether the payment has been recorded yet (the webhook may not
 * have arrived). Only this user's own records are queried, so tampered redirect params can't reveal
 * anyone else's data.
 * - Subscription: complete once the subscription has a successfully paid order (credits and the order
 *   are written in the same transaction); a failed charge counts as failed.
 * - One-time purchase: complete once the order is paid; failure counts as failed.
 * - No record of either yet: pending.
 */
/**
 * Clock skew allowance for the fallback lookup: the checkout time comes from the server and the order's
 * write time from the database, so leave some margin.
 */
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
   * Fallback lookup (when the provider's redirect carries no ID): this user's latest order for this
   * plan after this time. One-time purchases and every subscription period each write an order, so this
   * works for both kinds of plan.
   */
  planId?: string | null;
  since?: Date | null;
}): Promise<CheckoutStatus> {
  if (subscriptionId) {
    // Both queries are keyed by (userId, providerSubscriptionId) and independent, so send them in
    // parallel: the success page polls this repeatedly, and running them serially would add a round
    // trip to every poll. Priority is still "paid order > subscription past due".
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
