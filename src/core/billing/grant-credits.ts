import type { Plan } from "@/core/config/schema";
import type { GrantInput, WriteOptions } from "@/core/credits/service";

import type { BillingEvent } from "./events";
import type { OnBillingEventHandler } from "./on-billing-event";
import { getPlan } from "./plans";

/** Source of a credit transaction; (source, sourceId) ensures a payment is granted only once. */
export const BILLING_CREDITS_SOURCE = "billing";

/** Stable ledger identity, independent of whether the plan still exists. */
export function billingGrantSourceId(event: BillingEvent): string | null {
  if (event.type === "checkout.completed")
    return !event.subscriptionId && event.orderId
      ? `${event.provider}:order:${event.orderId}`
      : null;
  if (event.type !== "subscription.renewed") return null;
  const period = event.currentPeriodStart?.toISOString();
  return period
    ? `${event.provider}:subscription:${event.subscriptionId}:${period}`
    : event.orderId
      ? `${event.provider}:order:${event.orderId}`
      : null;
}

/**
 * How many credits this event should grant and with which idempotency key; returns null when nothing
 * is granted.
 * - One-time purchase: granted on checkout.completed when there is an order; the key is the order ID.
 * - Subscription: granted once per paid billing period (subscription.renewed, including the first
 *   period); the key is subscription ID + period start. Without billing period info it falls back to
 *   this payment's order ID. A subscription's checkout.completed and subscription.active grant nothing,
 *   so multiple events for the same period never grant twice.
 * - Reclaiming on refunds and late payments is handled by the later reclaim-credits hook.
 */
export function creditsForBillingEvent(
  event: BillingEvent,
): { amount: number; sourceId: string; reason: string } | null {
  const plan = planOf(event);
  const sourceId = billingGrantSourceId(event);
  if (!plan || plan.credits <= 0 || !sourceId) return null;

  if (event.type === "checkout.completed") {
    if (event.subscriptionId || !event.orderId) return null;
    return {
      amount: plan.credits,
      sourceId,
      reason: `Purchase of ${plan.id}`,
    };
  }

  if (event.type === "subscription.renewed") {
    const period = event.currentPeriodStart?.toISOString();
    return {
      amount: plan.credits,
      sourceId,
      reason: `Subscription ${plan.id} period${period ? ` from ${period}` : ""}`,
    };
  }

  return null;
}

function planOf(event: BillingEvent): Plan | undefined {
  const planId = "planId" in event ? event.planId : undefined;
  return planId ? getPlan(planId) : undefined;
}

/**
 * onBillingEvent hook that grants credits. Calls grantCredits with the event's transaction, so it
 * commits or rolls back together with event handling. Old events arriving out of order (stale) are
 * still granted; duplicates are blocked by (source, sourceId).
 */
export function createGrantCreditsHandler({
  enabled,
  grantCredits,
}: {
  enabled: boolean;
  grantCredits: (input: GrantInput, options: WriteOptions) => Promise<unknown>;
}): OnBillingEventHandler {
  return async (event, { tx, userId }) => {
    if (!enabled) return;
    const grant = creditsForBillingEvent(event);
    if (!grant) return;
    await grantCredits(
      {
        userId,
        amount: grant.amount,
        source: BILLING_CREDITS_SOURCE,
        sourceId: grant.sourceId,
        reason: grant.reason,
      },
      { tx },
    );
  };
}
