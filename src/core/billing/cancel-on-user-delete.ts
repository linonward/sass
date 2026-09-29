import { and, eq, inArray } from "drizzle-orm";

import type { OnUserDeleteHandler } from "@/core/account/on-user-delete";
import type { Database } from "@/core/db";
import { subscriptions } from "@/core/db/schema";

import type { PaymentProvider } from "./provider";

/**
 * Subscription statuses that will still be charged. canceled won't renew and expired has ended, so
 * neither needs canceling.
 */
const BILLABLE_STATUSES = ["active", "past_due"] as const;

/**
 * Before an account is deleted, cancel that user's subscriptions that would still renew at the provider.
 * provider.cancelSubscription treats already-canceled or missing subscriptions as success, so the hook
 * is safe to retry. Real errors are thrown, which aborts account deletion — better than deleting the
 * account while it keeps getting charged. If no provider is configured (local, CI) but the user has
 * subscriptions to cancel, it also throws; it must not silently skip them.
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
