import { and, eq } from "drizzle-orm";

import { db as defaultDb, type Database, type DbTransaction } from "@/core/db";
import {
  billingCustomers,
  orders,
  subscriptions,
  user,
  webhookEvents,
  type OrderStatus,
  type SubscriptionStatus,
} from "@/core/db/schema";
import { runAfterResponse } from "@/core/lib/after-response";
import { logger } from "@/core/observability/logger";

import type { BillingEvent } from "./events";
import "./hooks";
import {
  runAfterCommit,
  runOnBillingEvent,
  type AfterCommitCallback,
} from "./on-billing-event";

export type HandleBillingEventResult =
  /**
   * Handled for the first time. stale = true means an old event arrived out of order and didn't
   * change the subscription status.
   */
  | { status: "processed"; userId: string; stale: boolean }
  /** The same event was already handled; nothing was done. */
  | { status: "duplicate" }
  /**
   * The user the event points to no longer exists (e.g. account deleted). Recorded but not handled,
   * and not retried.
   */
  | { status: "ignored"; reason: "unknown_user" };

/**
 * Can't tell which user the event belongs to: there's no userId, and no customer ID, subscription or
 * order recorded yet (usually out-of-order delivery, e.g. a renewal arriving before checkout). The
 * transaction rolls back without recording webhook_events, and it's handled when the provider retries.
 */
export class UnresolvedBillingUserError extends Error {
  constructor(readonly event: Pick<BillingEvent, "provider" | "eventId">) {
    super(
      `Cannot resolve user for billing event ${event.provider}/${event.eventId}`,
    );
    this.name = "UnresolvedBillingUserError";
  }
}

/**
 * Handle one billing event in a single transaction:
 * 1. Idempotency: insert into webhook_events; if (provider, event_id) exists, return duplicate;
 * 2. Update subscriptions, orders and the customer mapping;
 * 3. Fire onBillingEvent hooks (which receive the same transaction).
 * Any failing step rolls everything back, leaving no webhook_events record, so a retry reprocesses it.
 * Callbacks that hooks register via afterCommit (e.g. sending email) run only after a successful commit.
 */
export async function handleBillingEvent(
  event: BillingEvent,
  { db = defaultDb }: { db?: Database } = {},
): Promise<HandleBillingEventResult> {
  const afterCommit: AfterCommitCallback[] = [];
  const result = await processInTransaction(db, event, afterCommit);
  // Run post-commit callbacks such as email after the response, so they don't slow the webhook
  // reply (providers have timeouts and retries).
  await runAfterResponse(() => runAfterCommit(afterCommit));
  return result;
}

function processInTransaction(
  db: Database,
  event: BillingEvent,
  afterCommit: AfterCommitCallback[],
): Promise<HandleBillingEventResult> {
  return db.transaction(async (tx) => {
    const [recorded] = await tx
      .insert(webhookEvents)
      .values({
        provider: event.provider,
        eventId: event.eventId,
        type: event.type,
        occurredAt: event.occurredAt,
        raw: event.raw ?? null,
      })
      .onConflictDoNothing({
        target: [webhookEvents.provider, webhookEvents.eventId],
      })
      .returning({ id: webhookEvents.id });
    if (!recorded) return { status: "duplicate" as const };

    const userId = await resolveUserId(tx, event);
    if (userId === null) {
      logger.warn("billing.event_unknown_user", {
        provider: event.provider,
        eventId: event.eventId,
        eventType: event.type,
      });
      return { status: "ignored" as const, reason: "unknown_user" as const };
    }

    const stale = await applyEvent(tx, event, userId);
    if (stale) {
      await tx
        .update(webhookEvents)
        .set({ stale: true })
        .where(eq(webhookEvents.id, recorded.id));
    }

    await runOnBillingEvent(event, {
      tx,
      stale,
      userId,
      afterCommit: (fn) => afterCommit.push(fn),
    });
    return { status: "processed" as const, userId, stale };
  });
}

/**
 * The event's userId wins; otherwise look up by customer ID, subscription, then order. Returns null
 * if the user was deleted.
 */
async function resolveUserId(
  tx: DbTransaction,
  event: BillingEvent,
): Promise<string | null> {
  if (event.userId) {
    const [found] = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, event.userId));
    if (!found) return null;
    if (event.customerId) await linkCustomer(tx, event, found.id);
    return found.id;
  }

  if (event.customerId) {
    const [found] = await tx
      .select({ userId: billingCustomers.userId })
      .from(billingCustomers)
      .where(
        and(
          eq(billingCustomers.provider, event.provider),
          eq(billingCustomers.providerCustomerId, event.customerId),
        ),
      );
    if (found) return found.userId;
  }

  const subscriptionId = "subscriptionId" in event && event.subscriptionId;
  if (subscriptionId) {
    const [found] = await tx
      .select({ userId: subscriptions.userId })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.provider, event.provider),
          eq(subscriptions.providerSubscriptionId, subscriptionId),
        ),
      );
    if (found) return found.userId;
  }

  const orderId = "orderId" in event && event.orderId;
  if (orderId) {
    const [found] = await tx
      .select({ userId: orders.userId })
      .from(orders)
      .where(
        and(
          eq(orders.provider, event.provider),
          eq(orders.providerOrderId, orderId),
        ),
      );
    if (found) return found.userId;
  }

  throw new UnresolvedBillingUserError(event);
}

/**
 * Remember the user's customer ID at the provider, so later events carrying only a customer ID can
 * find the user.
 */
async function linkCustomer(
  tx: DbTransaction,
  event: BillingEvent,
  userId: string,
) {
  await tx
    .insert(billingCustomers)
    .values({
      userId,
      provider: event.provider,
      providerCustomerId: event.customerId!,
      raw: event.raw ?? null,
    })
    .onConflictDoUpdate({
      target: [billingCustomers.provider, billingCustomers.userId],
      set: { providerCustomerId: event.customerId!, updatedAt: new Date() },
    });
}

/**
 * Update subscriptions and orders by event type. Returns true if the subscription status was
 * superseded (an old out-of-order event).
 */
async function applyEvent(
  tx: DbTransaction,
  event: BillingEvent,
  userId: string,
): Promise<boolean> {
  switch (event.type) {
    case "checkout.completed":
      if (event.orderId) {
        await mergeOrder(tx, event, userId, event.orderId, {
          outcome: "paid",
          amount: event.amount,
          currency: event.currency,
          planId: event.planId,
          subscriptionId: event.subscriptionId,
        });
      }
      return false;

    case "subscription.active":
    case "subscription.renewed": {
      const stale = await applySubscription(tx, event, userId, {
        status: "active",
        planId: event.planId,
        currentPeriodStart: event.currentPeriodStart,
        currentPeriodEnd: event.currentPeriodEnd,
        canceledAt: null,
        endedAt: null,
      });
      if (event.type === "subscription.renewed" && event.orderId) {
        await mergeOrder(tx, event, userId, event.orderId, {
          outcome: "paid",
          amount: event.amount,
          currency: event.currency,
          planId: event.planId,
          subscriptionId: event.subscriptionId,
        });
      }
      return stale;
    }

    case "subscription.canceled":
      return applySubscription(tx, event, userId, {
        status: "canceled",
        canceledAt: event.occurredAt,
        currentPeriodEnd: event.currentPeriodEnd,
      });

    case "subscription.expired":
      return applySubscription(tx, event, userId, {
        status: "expired",
        endedAt: event.occurredAt,
      });

    case "payment.failed": {
      const stale = event.subscriptionId
        ? await applySubscription(tx, event, userId, { status: "past_due" })
        : false;
      if (event.orderId) {
        await mergeOrder(tx, event, userId, event.orderId, {
          outcome: "failed",
          amount: event.amount,
          currency: event.currency,
          subscriptionId: event.subscriptionId,
        });
      }
      return stale;
    }

    case "refund.created":
      await mergeOrder(tx, event, userId, event.orderId, {
        refund: event.amount,
        currency: event.currency,
      });
      return false;
  }
}

type SubscriptionPatch = {
  status: SubscriptionStatus;
  planId?: string;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  canceledAt?: Date | null;
  endedAt?: Date | null;
};

/**
 * Drop fields whose value is undefined: information the event didn't carry doesn't overwrite
 * existing values.
 */
function defined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

/**
 * Subscriptions use "last writer wins" by event time: an event earlier than the latest recorded one
 * doesn't change the status (returns true) and only fills in plan and customer info that is still
 * empty. That way, renewed arriving before active, or an old renewed arriving after canceled, both end
 * in the same state as in-order delivery.
 */
async function applySubscription(
  tx: DbTransaction,
  event: BillingEvent & { subscriptionId?: string },
  userId: string,
  patch: SubscriptionPatch,
): Promise<boolean> {
  const where = and(
    eq(subscriptions.provider, event.provider),
    eq(subscriptions.providerSubscriptionId, event.subscriptionId!),
  );
  const [inserted] = await tx
    .insert(subscriptions)
    .values({
      userId,
      provider: event.provider,
      providerSubscriptionId: event.subscriptionId!,
      providerCustomerId: event.customerId,
      lastEventAt: event.occurredAt,
      raw: event.raw ?? null,
      ...defined(patch),
      status: patch.status,
    })
    .onConflictDoNothing({
      target: [subscriptions.provider, subscriptions.providerSubscriptionId],
    })
    .returning({ id: subscriptions.id });
  if (inserted) return false;

  // Row lock: concurrent events for the same subscription are processed serially.
  const [locked] = await tx
    .select()
    .from(subscriptions)
    .where(where)
    .for("update");
  // The row must exist by now (just inserted above or already there); for update serializes
  // concurrent events for the same subscription.
  const current = locked!;

  const fillMissing = defined({
    planId: current.planId ? undefined : patch.planId,
    providerCustomerId: current.providerCustomerId
      ? undefined
      : event.customerId,
  });

  if (event.occurredAt < current.lastEventAt) {
    if (Object.keys(fillMissing).length > 0) {
      await tx
        .update(subscriptions)
        .set({ ...fillMissing, updatedAt: new Date() })
        .where(where);
    }
    return true;
  }

  await tx
    .update(subscriptions)
    .set({
      ...fillMissing,
      ...defined(patch),
      lastEventAt: event.occurredAt,
      raw: event.raw ?? null,
      updatedAt: new Date(),
    })
    .where(where);
  return false;
}

type OrderPatch = {
  /** Outcome of this payment; refund events don't carry it. */
  outcome?: "paid" | "failed";
  /** Amount refunded in this event. */
  refund?: number;
  amount?: number;
  currency?: string;
  planId?: string;
  subscriptionId?: string;
};

/**
 * Merging orders doesn't depend on arrival order: payment success beats failure, refund amounts add
 * up, missing amount, currency and plan are filled in by later events, and the status is finally
 * derived from the amounts. So orders have no "old events".
 */
async function mergeOrder(
  tx: DbTransaction,
  event: BillingEvent,
  userId: string,
  orderId: string,
  patch: OrderPatch,
) {
  const where = and(
    eq(orders.provider, event.provider),
    eq(orders.providerOrderId, orderId),
  );
  await tx
    .insert(orders)
    .values({
      userId,
      provider: event.provider,
      providerOrderId: orderId,
      // Placeholder; recomputed below from the merged data.
      status: patch.outcome ?? "paid",
    })
    .onConflictDoNothing({
      target: [orders.provider, orders.providerOrderId],
    });

  const [locked] = await tx.select().from(orders).where(where).for("update");
  // The row must exist by now (just inserted above or already there); for update serializes
  // concurrent events for the same order.
  const current = locked!;

  // Payment success wins: a single success means paid (a refund also implies it was paid).
  const base: OrderStatus =
    current.status !== "failed" || patch.outcome === "paid" ? "paid" : "failed";
  const merged = {
    amount: current.amount ?? patch.amount ?? null,
    currency: current.currency ?? patch.currency ?? null,
    planId: current.planId ?? patch.planId ?? null,
    providerSubscriptionId:
      current.providerSubscriptionId ?? patch.subscriptionId ?? null,
    refundedAmount: current.refundedAmount + (patch.refund ?? 0),
  };
  const status: OrderStatus =
    merged.refundedAmount > 0
      ? merged.amount !== null && merged.refundedAmount < merged.amount
        ? "partially_refunded"
        : "refunded"
      : base;

  await tx
    .update(orders)
    .set({ ...merged, status, raw: event.raw ?? null, updatedAt: new Date() })
    .where(where);
}
