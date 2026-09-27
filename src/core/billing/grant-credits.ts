import type { Plan } from "@/core/config/schema";
import type { GrantInput, WriteOptions } from "@/core/credits/service";

import type { BillingEvent } from "./events";
import type { OnBillingEventHandler } from "./on-billing-event";
import { getPlan } from "./plans";

/** 积分流水的来源；(source, sourceId) 保证同一笔付款只发一次。 */
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
 * 这个事件应该发放多少积分、用什么幂等键；不发放时返回 null。
 * - 一次性购买：checkout.completed 且有订单时发放，键为订单 ID。
 * - 订阅：每个已付款的账期发放一次（subscription.renewed，含首期），键为订阅 ID + 账期开始时间；
 *   没有账期信息时退回用这次付款的订单 ID。订阅的 checkout.completed、subscription.active
 *   不发放，所以同一账期的多个事件不会重复发。
 * - 退款与迟到付款的回收由后续 reclaim-credits 钩子处理。
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
 * 发放积分的 onBillingEvent 钩子。用事件的事务调用 grantCredits，和事件处理一起提交或回滚；
 * 乱序到达的旧事件（stale）照样发放，重复由 (source, sourceId) 挡住。
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
