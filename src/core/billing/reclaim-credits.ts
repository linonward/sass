import { and, eq, or, sql } from "drizzle-orm";

import type { DbTransaction } from "@/core/db";
import { creditTransactions, orders } from "@/core/db/schema";
import type { ReclaimInput, ReclaimResult, WriteOptions } from "@/core/credits";
import { openException } from "@/core/exceptions/open";
import { logger } from "@/core/observability/logger";

import type { BillingEvent } from "./events";
import type { OnBillingEventHandler } from "./on-billing-event";
import { BILLING_CREDITS_SOURCE, billingGrantSourceId } from "./grant-credits";
import { historicalGrantSourceId } from "./historical-grant";

/**
 * Source of the credit transactions produced by refund reclaims.
 *
 * Deliberately not called `refund`: that source is already taken in the credits service —
 * `refundCredits()` uses it to record "returning a deduction" (e.g. refunding a failed AI call).
 * What's recorded here is an automatic reclaim triggered by a payment refund, which is a real
 * deduction, so it uses the `deduct` type plus its own source.
 */
export const REFUND_RECLAIM_SOURCE = "billing-refund";

/** One reclaim transaction per refund event; repeated deliveries are blocked by (source, sourceId). */
export function reclaimSourceId(
  provider: string,
  orderId: string,
  refundId: string,
) {
  return `${provider}:order:${orderId}:refund:${refundId}`;
}

/**
 * LIKE prefix matching must escape % _ \. orderId comes from the provider and normally contains none
 * of these, but don't bet on it.
 */
function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * How many credits have already been reclaimed on this order (claimed by sourceId prefix, in the same
 * format used when writing). Transactions written by "retry reclaim" on the admin exceptions page also
 * sit under this prefix (see `retryReclaimSourceId`), so retried reclaims count too and are never
 * reclaimed twice.
 */
async function reclaimedForOrder(
  tx: DbTransaction,
  provider: string,
  orderId: string,
) {
  const prefix = `${provider}:order:${orderId}:refund:`;
  const [row] = await tx
    .select({
      total: sql<string>`coalesce(sum(abs(${creditTransactions.amount})), 0)`,
    })
    .from(creditTransactions)
    .where(
      and(
        eq(creditTransactions.source, REFUND_RECLAIM_SOURCE),
        or(
          sql`${creditTransactions.sourceId} like ${`${escapeLike(prefix)}%`}`,
          eq(
            creditTransactions.sourceId,
            `${provider}:order:${orderId}:payment`,
          ),
        ),
      ),
    );
  return Number(row?.total ?? 0);
}

type ReclaimEvent = Extract<
  BillingEvent,
  { type: "refund.created" | "checkout.completed" | "subscription.renewed" }
> & { orderId: string };

export type ReclaimPlan = {
  /** Credits to reclaim this time (not yet capped by the balance). */
  amount: number;
  sourceId: string;
  reason: string;
};

/**
 * How many credits this order still owes on a cumulative basis (may be ≤ 0, meaning nothing owed):
 *
 *   owed = floor(granted × total refunded / order amount) − already reclaimed on this order
 */
function cumulativeOwed({
  order,
  granted,
  alreadyReclaimed,
}: {
  order: { amount: number | null; refundedAmount: number };
  granted: number;
  alreadyReclaimed: number;
}) {
  if (!order.amount || order.amount <= 0) return 0;
  const refunded = Math.min(order.refundedAmount, order.amount);
  return Math.floor((granted * refunded) / order.amount) - alreadyReclaimed;
}

/**
 * Compute how many credits one refund should reclaim. The ratio is **cumulative**:
 *
 *   owed = floor(granted × total refunded / order amount) − already reclaimed on this order
 *
 * Rounding each refund separately leaks credits (a 100-credit order refunded in three 1/3 parts floors
 * to 33, 33, 33 and misses 1 credit); on a cumulative basis the last refund makes up the difference.
 *
 * The reason text **doesn't include the reclaim amount**: the amount gets capped by the balance, and
 * the transaction is written before the balance is updated, so the text is fixed at write time — the
 * number written into it might not match the transaction amount. The amount itself is on the
 * transaction, and the capped difference is logged by the caller.
 */
export function creditsToReclaim({
  event,
  order,
  granted,
  alreadyReclaimed,
}: {
  event: ReclaimEvent;
  order: { amount: number | null; refundedAmount: number };
  granted: number;
  alreadyReclaimed: number;
}): ReclaimPlan | null {
  const owed = cumulativeOwed({ order, granted, alreadyReclaimed });
  if (owed <= 0) return null;
  const refunded = Math.min(order.refundedAmount, order.amount!);
  const refundId =
    event.type === "refund.created" ? event.refundId : event.eventId;
  const label = `Refund of ${event.provider} order ${event.orderId} (${refundId})`;
  return {
    amount: owed,
    sourceId:
      event.type === "refund.created"
        ? reclaimSourceId(event.provider, event.orderId, event.refundId)
        : `${event.provider}:order:${event.orderId}:payment`,
    reason: refunded < order.amount! ? `Partial ${label}` : label,
  };
}

/**
 * sourceId for transactions written by "retry reclaim" on the exceptions page. It sits under the same
 * order's `:refund:` prefix, so `reclaimedForOrder` counts it as reclaimed and the cumulative basis
 * stays the same.
 *
 * Includes the exception id and the attempt number: the same attempt (double-click, network retry)
 * hits the (source, sourceId) unique key and deducts only once. The real guard against duplicates is
 * locking the order row on retry and recomputing what's still owed from the ledger (see
 * ../exceptions/service.ts).
 */
export function retryReclaimSourceId(
  provider: string,
  orderId: string,
  exceptionId: string,
  attempt: number,
) {
  return `${provider}:order:${orderId}:refund:retry:${exceptionId}:${attempt}`;
}

/**
 * Lock the order row and recompute from the ledger how many credits this order owes now (same formula
 * and same already-reclaimed basis as the webhook reclaim). Returns null if the order or the grant
 * transaction can't be found.
 */
export async function owedForOrder(
  tx: DbTransaction,
  {
    provider,
    orderId,
    userId,
  }: { provider: string; orderId: string; userId: string },
) {
  const [order] = await tx
    .select({
      amount: orders.amount,
      refundedAmount: orders.refundedAmount,
      creditGrantSourceId: orders.creditGrantSourceId,
    })
    .from(orders)
    .where(
      and(eq(orders.provider, provider), eq(orders.providerOrderId, orderId)),
    )
    .for("update");
  if (!order?.creditGrantSourceId) return null;
  const [grant] = await tx
    .select({ amount: creditTransactions.amount })
    .from(creditTransactions)
    .where(
      and(
        eq(creditTransactions.userId, userId),
        eq(creditTransactions.source, BILLING_CREDITS_SOURCE),
        eq(creditTransactions.sourceId, order.creditGrantSourceId),
        eq(creditTransactions.type, "grant"),
      ),
    );
  if (!grant || grant.amount <= 0) return null;
  const alreadyReclaimed = await reclaimedForOrder(tx, provider, orderId);
  return {
    owed: cumulativeOwed({ order, granted: grant.amount, alreadyReclaimed }),
    granted: grant.amount,
    alreadyReclaimed,
  };
}

/**
 * onBillingEvent hook that reclaims credits on refund.
 *
 * The reclaim amount is based on the actual billing grant transaction; if the refund arrives first,
 * the later payment compensates after the grant hook. The actual deduction is capped by the credits
 * service at the balance: if the balance is too low it goes down to 0 and the difference is logged
 * (the transaction is written before the balance is updated, and amount has a non-zero constraint, so
 * the difference can't go into the transaction note). Duplicates are blocked by two layers of
 * idempotency: webhook_events and the transactions' (source, sourceId).
 */
export function createReclaimCreditsHandler({
  enabled,
  reclaimCredits,
}: {
  enabled: boolean;
  reclaimCredits: (
    input: ReclaimInput,
    options: WriteOptions,
  ) => Promise<ReclaimResult>;
}): OnBillingEventHandler {
  return async (event, { tx, userId }) => {
    if (
      !enabled ||
      (event.type !== "refund.created" &&
        event.type !== "checkout.completed" &&
        event.type !== "subscription.renewed") ||
      !event.orderId
    )
      return;
    const trigger: ReclaimEvent = { ...event, orderId: event.orderId };

    const [order] = await tx
      .select({
        amount: orders.amount,
        id: orders.id,
        creditGrantSourceId: orders.creditGrantSourceId,
        refundedAmount: orders.refundedAmount,
      })
      .from(orders)
      .where(
        and(
          eq(orders.provider, event.provider),
          eq(orders.providerOrderId, event.orderId),
        ),
      );

    if (!order) return;
    const sourceId =
      order.creditGrantSourceId ??
      billingGrantSourceId(event) ??
      (await historicalGrantSourceId(tx, event.provider, event.orderId)) ??
      `${event.provider}:order:${event.orderId}`;
    const [grant] = await tx
      .select({ amount: creditTransactions.amount })
      .from(creditTransactions)
      .where(
        and(
          eq(creditTransactions.userId, userId),
          eq(creditTransactions.source, BILLING_CREDITS_SOURCE),
          eq(creditTransactions.sourceId, sourceId),
          eq(creditTransactions.type, "grant"),
        ),
      );
    const granted = grant?.amount ?? 0;
    if (granted <= 0) return;
    // mergeOrder already holds this order's row lock for the whole transaction.
    if (!order.creditGrantSourceId)
      await tx
        .update(orders)
        .set({ creditGrantSourceId: sourceId })
        .where(eq(orders.id, order.id));
    if (order.refundedAmount <= 0) return;

    const plan = creditsToReclaim({
      event: trigger,
      order,
      granted,
      alreadyReclaimed: await reclaimedForOrder(
        tx,
        event.provider,
        event.orderId,
      ),
    });
    if (!plan) {
      logger.info("billing.refund_reclaim_skipped", {
        provider: event.provider,
        eventId: event.eventId,
        orderId: event.orderId,
        refundId: event.type === "refund.created" ? event.refundId : undefined,
        orderAmount: order.amount,
        refundedAmount: order.refundedAmount,
        granted,
      });
      return;
    }

    const result = await reclaimCredits(
      {
        userId,
        amount: plan.amount,
        source: REFUND_RECLAIM_SOURCE,
        sourceId: plan.sourceId,
        reason: plan.reason,
      },
      { tx },
    );

    if (result.shortfall > 0) {
      // Balance too low: the part that should have been deducted but wasn't can't go into a
      // transaction (amount has a non-zero constraint, and when nothing at all can be deducted there's
      // no transaction at all), so open an exception to record it, visible and retryable in the admin.
      // It's in the same transaction as the reclaim: if the transaction rolls back (e.g. a brief
      // database outage) the exception disappears with it and is reopened when the webhook replays —
      // the unique key guarantees there's only one. The log is still kept as before.
      const detail = {
        provider: event.provider,
        orderId: event.orderId,
        refundId: event.type === "refund.created" ? event.refundId : undefined,
        userId,
        owed: plan.amount,
        reclaimed: result.reclaimed,
        shortfall: result.shortfall,
        balance: result.balance,
      };
      logger.warn("billing.refund_reclaim_shortfall", detail);
      await openException(tx, {
        kind: "refund_reclaim_shortfall",
        userId,
        source: REFUND_RECLAIM_SOURCE,
        sourceId: plan.sourceId,
        detail: {
          ...detail,
          orderAmount: order.amount,
          refundedAmount: order.refundedAmount,
          granted,
        },
      });
    }
  };
}
