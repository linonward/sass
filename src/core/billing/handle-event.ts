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
  /** 首次处理。stale 为 true 表示是乱序到达的旧事件，没有改动订阅状态。 */
  | { status: "processed"; userId: string; stale: boolean }
  /** 同一事件已经处理过，什么也没做。 */
  | { status: "duplicate" }
  /** 事件指向的用户已不存在（例如账户已删除）。记录下来但不处理，也不再重试。 */
  | { status: "ignored"; reason: "unknown_user" };

/**
 * 找不到事件属于哪个用户：没有 userId，客户 ID、订阅、订单也都还没有记录（通常是乱序，
 * 例如续费事件先于结账事件到达）。事务回滚、不记入 webhook_events，服务商重试时再处理。
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
 * 处理一个账单事件，在一个事务里完成：
 * 1. 幂等：写入 webhook_events，(provider, event_id) 已存在就直接返回 duplicate；
 * 2. 更新订阅、订单和客户映射；
 * 3. 触发 onBillingEvent 钩子（接收同一个事务）。
 * 任何一步失败都会整体回滚，webhook_events 里也不会留下记录，重试时重新处理。
 * 钩子用 afterCommit 登记的回调（例如发邮件）在事务提交成功后才执行。
 */
export async function handleBillingEvent(
  event: BillingEvent,
  { db = defaultDb }: { db?: Database } = {},
): Promise<HandleBillingEventResult> {
  const afterCommit: AfterCommitCallback[] = [];
  const result = await processInTransaction(db, event, afterCommit);
  // 邮件等提交后的回调放到响应之后，不拖慢 webhook 的回复（服务商有超时和重试）。
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

/** 事件里的 userId 优先；否则按客户 ID、订阅、订单依次查找。用户已删除时返回 null。 */
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

/** 记住用户在服务商那边的客户 ID，之后只带客户 ID 的事件也能找到用户。 */
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

/** 按事件类型更新订阅和订单。返回 true 表示订阅状态被更新的事件覆盖（乱序的旧事件）。 */
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

/** 去掉值为 undefined 的字段：事件没带的信息不覆盖已有的值。 */
function defined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

/**
 * 订阅按事件发生时间"后写入者胜"：比已记录的最新事件更早的事件不改变状态（返回 true），
 * 只补上仍为空的套餐和客户信息。这样 renewed 先于 active 到达、canceled 之后才到的
 * 旧 renewed，最终状态都和按顺序到达时一致。
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

  // 行锁：同一订阅的并发事件串行处理。
  const [current] = await tx
    .select()
    .from(subscriptions)
    .where(where)
    .for("update");

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
  /** 这次付款的结果；退款事件不带。 */
  outcome?: "paid" | "failed";
  /** 本次退款金额。 */
  refund?: number;
  amount?: number;
  currency?: string;
  planId?: string;
  subscriptionId?: string;
};

/**
 * 订单的合并与到达顺序无关：付款成功优先于失败，退款金额累加，缺失的金额、币种、
 * 套餐用后到的事件补上，最后由金额推导状态。所以订单不存在"旧事件"。
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
      // 占位，下面按合并后的数据重新计算。
      status: patch.outcome ?? "paid",
    })
    .onConflictDoNothing({
      target: [orders.provider, orders.providerOrderId],
    });

  const [current] = await tx.select().from(orders).where(where).for("update");

  // 付款成功优先：只要有一次成功就是 paid（退款也意味着付过款）。
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
