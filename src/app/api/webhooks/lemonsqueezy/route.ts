import { getBillingProvider } from "@/core/billing/providers";
import { LEMONSQUEEZY_PROVIDER_ID } from "@/core/billing/providers/lemonsqueezy";
import { processWebhook } from "@/core/billing/webhook";

/**
 * Lemon Squeezy webhook: verifies the signature, then hands off to handleBillingEvent. Configure it
 * in the LS dashboard as https://<domain>/api/webhooks/lemonsqueezy.
 */
export async function POST(request: Request) {
  const provider = getBillingProvider();
  if (!provider || provider.id !== LEMONSQUEEZY_PROVIDER_ID) {
    return Response.json({ error: "billing_not_configured" }, { status: 503 });
  }
  return processWebhook(provider, request);
}
