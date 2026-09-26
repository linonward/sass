import { runAfterResponse } from "@/core/lib/after-response";
import { trackEvents } from "@/core/observability/events";
import type { ServerTracker } from "@/core/observability/track-server";

import type { OnBillingEventHandler } from "./on-billing-event";

/**
 * checkout.completed → Vercel Analytics 的 purchase 事件（只带套餐 ID）。
 * 只算首次付款（一次性购买或订阅首付），续费不算转化。每个事件只触发一次（webhook 幂等）。
 * 事务提交之后、响应之后再发，统计失败或变慢都不影响 webhook。
 * webhook 由支付服务商调用，没有访客的请求上下文：显式传空 headers，事件照常记录，
 * 来源、设备和地区为空（不能用 webhook 请求本身的 headers，那是服务商的服务器）。
 */
export function createPurchaseTrackingHandler({
  track,
}: {
  track: ServerTracker;
}): OnBillingEventHandler {
  return (event, { afterCommit }) => {
    if (event.type !== "checkout.completed") return;
    const plan = event.planId ?? null;
    afterCommit(() =>
      runAfterResponse(() =>
        track(trackEvents.purchase, { plan }, { headers: {} }),
      ),
    );
  };
}
