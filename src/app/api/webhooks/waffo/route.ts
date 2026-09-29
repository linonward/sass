import { getBillingProvider } from "@/core/billing/providers";
import { WAFFO_PROVIDER_ID } from "@/core/billing/providers/waffo";
import { processWebhook } from "@/core/billing/webhook";

/**
 * Waffo Pancake webhook: verifies the signature (for the WAFFO_MODE environment), then hands off to
 * handleBillingEvent. Configure it under Webhooks in the Pancake dashboard as
 * https://<domain>/api/webhooks/waffo.
 */
export async function POST(request: Request) {
  const provider = getBillingProvider();
  if (!provider || provider.id !== WAFFO_PROVIDER_ID) {
    return Response.json({ error: "billing_not_configured" }, { status: 503 });
  }
  return processWebhook(provider, request);
}
