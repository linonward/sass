import { and, desc, eq, gt, inArray, isNull, or } from "drizzle-orm";

import type { Plan } from "@/core/config/schema";
import type { Database } from "@/core/db";
import { billingCustomers, orders, subscriptions } from "@/core/db/schema";
import type { SubscriptionStatus } from "@/core/db/schema";

export type BillingOverview = {
  /** Subscriptions still in use: active, past_due, or canceled but not yet expired. */
  subscription: {
    planId: string | null;
    status: SubscriptionStatus;
    currentPeriodEnd: Date | null;
    canceledAt: Date | null;
  } | null;
  /** Paid one-time plans. */
  purchasedPlanIds: string[];
  /** Whether a customer record exists at the provider (required to open the customer portal). */
  hasCustomer: boolean;
};

/** Current state used by the billing and pricing pages. */
export async function getBillingOverview({
  db,
  userId,
  now = new Date(),
}: {
  db: Database;
  userId: string;
  now?: Date;
}): Promise<BillingOverview> {
  // The three queries are independent; run them in parallel.
  const [[subscription], purchases, [customer]] = await Promise.all([
    db
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
      .limit(1),
    db
      .selectDistinct({ planId: orders.planId })
      .from(orders)
      .where(
        and(
          eq(orders.userId, userId),
          eq(orders.status, "paid"),
          isNull(orders.providerSubscriptionId),
        ),
      ),
    db
      .select({ id: billingCustomers.id })
      .from(billingCustomers)
      .where(eq(billingCustomers.userId, userId))
      .limit(1),
  ]);

  return {
    subscription: subscription ?? null,
    purchasedPlanIds: purchases
      .map((p) => p.planId)
      .filter((id): id is string => Boolean(id)),
    hasCustomer: Boolean(customer),
  };
}

/**
 * Pricing button state: subscribed plans show "Manage subscription", purchased one-time plans show
 * "Purchased".
 */
export function ownedPlans(overview: BillingOverview) {
  const owned: Record<string, "subscribed" | "purchased"> = {};
  for (const id of overview.purchasedPlanIds) owned[id] = "purchased";
  if (overview.subscription?.planId) {
    owned[overview.subscription.planId] = "subscribed";
  }
  return owned;
}

/**
 * What the billing page says about the user's plan when there's no subscription line to show:
 * - `subscription`: an active (or not yet expired) subscription;
 * - `purchased`: no subscription, but paid one-time plans (a one-time purchase creates no subscription);
 * - `free`: neither, and a free plan (price 0) is listed;
 * - `none`: neither, and the free plan is hidden or doesn't exist, so "you're on the free plan" would be false.
 *
 * `listed` is listedPlans(): a free plan hidden with SITE_HIDDEN_PLANS doesn't count.
 */
export function planSummary(
  overview: Pick<BillingOverview, "subscription" | "purchasedPlanIds">,
  listed: readonly Pick<Plan, "price">[],
): "subscription" | "purchased" | "free" | "none" {
  if (overview.subscription) return "subscription";
  if (overview.purchasedPlanIds.length > 0) return "purchased";
  return listed.some((plan) => plan.price === 0) ? "free" : "none";
}
