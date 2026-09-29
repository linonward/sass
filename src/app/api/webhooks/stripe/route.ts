import { getBillingProvider } from "@/core/billing/providers";
import { STRIPE_PROVIDER_ID } from "@/core/billing/providers/stripe";
import { processWebhook } from "@/core/billing/webhook";

/**
 * Stripe webhook: verifies the signature, then hands off to handleBillingEvent. Configure it in the
 * Stripe dashboard (or `stripe listen`) as https://<domain>/api/webhooks/stripe.
 */
export async function POST(request: Request) {
  const provider = getBillingProvider();
  if (!provider || provider.id !== STRIPE_PROVIDER_ID) {
    return Response.json({ error: "billing_not_configured" }, { status: 503 });
  }
  return processWebhook(provider, request);
}
