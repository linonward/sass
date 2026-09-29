import { getBillingProvider } from "@/core/billing/providers";
import { CREEM_PROVIDER_ID } from "@/core/billing/providers/creem";
import { processWebhook } from "@/core/billing/webhook";

/**
 * Creem webhook: verifies the signature, then hands off to handleBillingEvent. Configure it in the
 * Creem dashboard as https://<domain>/api/webhooks/creem.
 */
export async function POST(request: Request) {
  const provider = getBillingProvider();
  if (!provider || provider.id !== CREEM_PROVIDER_ID) {
    return Response.json({ error: "billing_not_configured" }, { status: 503 });
  }
  return processWebhook(provider, request);
}
