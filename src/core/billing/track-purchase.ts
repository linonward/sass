import { runAfterResponse } from "@/core/lib/after-response";
import { trackEvents } from "@/core/observability/events";
import type { ServerTracker } from "@/core/observability/track-server";

import type { OnBillingEventHandler } from "./on-billing-event";

/**
 * checkout.completed → Vercel Analytics `purchase` event (with only the plan ID).
 * Only first payments count (one-time purchase or first subscription payment); renewals are not
 * conversions. Each event fires once (the webhook is idempotent). It's sent after the transaction
 * commits and after the response, so a failing or slow analytics call never affects the webhook.
 * The webhook is called by the payment provider, so there is no visitor request context: we pass
 * empty headers explicitly, the event is still recorded, and source, device and region are empty
 * (we can't use the webhook request's own headers — those belong to the provider's servers).
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
