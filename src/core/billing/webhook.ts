import type { Database } from "@/core/db";
import { logger } from "@/core/observability/logger";
import { recordSpanError, withSpan } from "@/core/observability/trace";

import { handleBillingEvent } from "./handle-event";
import { WebhookVerificationError, type PaymentProvider } from "./provider";

/**
 * Full webhook route handling: verify signature → parse event → handleBillingEvent, then map to an
 * HTTP response.
 * - 401: bad signature, nothing written; the provider shouldn't retry.
 * - 200: handled, duplicate event, event type we don't care about, or user already deleted.
 * - 500: handling failed (including hook failures or a user not found yet); the transaction was
 *   rolled back and we wait for the provider to retry.
 * The route only needs `return processWebhook(creem, request)`.
 */
export async function processWebhook(
  provider: PaymentProvider,
  request: Request,
  options: { db?: Database } = {},
): Promise<Response> {
  let payload: unknown;
  try {
    payload = await provider.verifyWebhook(request);
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      logger.warn("billing.webhook_invalid_signature", {
        provider: provider.id,
      });
      return Response.json({ error: "invalid_signature" }, { status: 401 });
    }
    throw error;
  }

  const event = provider.parseEvent(payload);
  if (!event) return Response.json({ status: "ignored" });

  const fields = {
    provider: event.provider,
    eventId: event.eventId,
    eventType: event.type,
  };
  return withSpan(
    "billing.webhook",
    {
      "billing.provider": event.provider,
      "billing.event_id": event.eventId,
      "billing.event_type": event.type,
    },
    async (span) => {
      try {
        const result = await handleBillingEvent(event, options);
        // duplicate: the same event was pushed again and was not processed twice.
        span.setAttribute("billing.result", result.status);
        logger.info("billing.webhook", { ...fields, result: result.status });
        return Response.json(result);
      } catch (error) {
        recordSpanError(span, error);
        logger.error("billing.webhook_failed", { ...fields, error });
        return Response.json({ error: "processing_failed" }, { status: 500 });
      }
    },
  );
}
