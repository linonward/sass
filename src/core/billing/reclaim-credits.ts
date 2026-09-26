import { and, eq, sql } from "drizzle-orm";

import type { DbTransaction } from "@/core/db";
import { creditTransactions, orders } from "@/core/db/schema";
import type { ReclaimInput, ReclaimResult, WriteOptions } from "@/core/credits";
import { logger } from "@/core/observability/logger";

import type { RefundCreatedEvent } from "./events";
import type { OnBillingEventHandler } from "./on-billing-event";
import { getPlan } from "./plans";

/**
 * 退款回收出来的积分流水的来源。
 *
 * 刻意不叫 `refund`：那个来源在积分服务里已经有主 —— `refundCredits()` 用它记
 * 「退还一笔扣减」（例如 AI 调用失败退费）。这里记的是支付退款触发的自动回收，
 * 是实打实的扣减，所以走 `deduct` 类型 + 自己的来源。
 */
export const REFUND_RECLAIM_SOURCE = "billing-refund";

/** 一条回收流水对应一次退款事件；重复推送被 (source, sourceId) 挡住。 */
export function reclaimSourceId(
  provider: string,
  orderId: string,
  refundId: string,
) {
  return `${provider}:order:${orderId}:refund:${refundId}`;
}

/** LIKE 前缀匹配要转义 % _ \。orderId 来自服务商，正常不含这些字符，但别赌。 */
function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** 这个订单上已经回收过多少积分（按 sourceId 前缀认领，和写入时同一个格式）。 */
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
        sql`${creditTransactions.sourceId} like ${`${escapeLike(prefix)}%`}`,
      ),
    );
  return Number(row?.total ?? 0);
}

export type ReclaimPlan = {
  /** 这次要回收的积分（还没按余额截断）。 */
  amount: number;
  sourceId: string;
  reason: string;
};

/**
 * 算一次退款应该回收多少积分。比例用**累计口径**：
 *
 *   owed = floor(发放积分 × 累计已退金额 / 订单金额) − 这个订单已回收的积分
 *
 * 逐次取整会漏积分（订单 100 分、分三次各退 1/3 时，每次 floor 得 33、33、33，少收 1 分），
 * 累计口径下最后一次正好补上。
 *
 * 理由文案**不写回收额度**：额度要按余额截断，而流水是先写流水后改余额，
 * 文案在写入时就定了 —— 写进去的数字和流水金额可能对不上。金额本身在流水上，
 * 截断的差额由调用方记日志。
 */
export function creditsToReclaim({
  event,
  order,
  granted,
  alreadyReclaimed,
}: {
  event: RefundCreatedEvent;
  order: { amount: number | null; refundedAmount: number };
  granted: number;
  alreadyReclaimed: number;
}): ReclaimPlan | null {
  if (!order.amount || order.amount <= 0) return null;
  const refunded = Math.min(order.refundedAmount, order.amount);
  const owedTotal = Math.floor((granted * refunded) / order.amount);
  const owed = owedTotal - alreadyReclaimed;
  if (owed <= 0) return null;
  const label = `Refund of ${event.provider} order ${event.orderId} (${event.refundId})`;
  return {
    amount: owed,
    sourceId: reclaimSourceId(event.provider, event.orderId, event.refundId),
    reason: refunded < order.amount ? `Partial ${label}` : label,
  };
}

/**
 * 退款回收集分的 onBillingEvent 钩子。
 *
 * 回收额度按订单对应的套餐配置算（订阅每个账期发放的就是 plan.credits，与一次性购买同源），
 * 实际扣减由积分服务按余额截断：余额不够时扣到 0，差额记日志
 * （流水先写后改余额，且 amount 有非零约束，所以差额进不了流水备注）。
 * 重复由 webhook_events 与流水的 (source, sourceId) 两道幂等挡住。
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
    if (!enabled || event.type !== "refund.created") return;

    const [order] = await tx
      .select({
        amount: orders.amount,
        planId: orders.planId,
        refundedAmount: orders.refundedAmount,
      })
      .from(orders)
      .where(
        and(
          eq(orders.provider, event.provider),
          eq(orders.providerOrderId, event.orderId),
        ),
      );

    const granted = order?.planId ? (getPlan(order.planId)?.credits ?? 0) : 0;
    if (!order || granted <= 0) return;

    const plan = creditsToReclaim({
      event,
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
        refundId: event.refundId,
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
      // 余额不够，应扣未扣的部分只能记在这里：流水的 amount 有非零约束，
      // 且一分都扣不动时根本没有流水可写。
      logger.warn("billing.refund_reclaim_shortfall", {
        provider: event.provider,
        orderId: event.orderId,
        refundId: event.refundId,
        userId,
        owed: plan.amount,
        reclaimed: result.reclaimed,
        shortfall: result.shortfall,
        balance: result.balance,
      });
    }
  };
}
