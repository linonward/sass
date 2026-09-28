import { getBillingProvider } from "@/core/billing/providers";
import { STRIPE_PROVIDER_ID } from "@/core/billing/providers/stripe";
import { processWebhook } from "@/core/billing/webhook";

/** Stripe webhook：校验签名后交给 handleBillingEvent。在 Stripe 后台（或 `stripe listen`）配置为 https://<domain>/api/webhooks/stripe。 */
export async function POST(request: Request) {
  const provider = getBillingProvider();
  if (!provider || provider.id !== STRIPE_PROVIDER_ID) {
    return Response.json({ error: "billing_not_configured" }, { status: 503 });
  }
  return processWebhook(provider, request);
}
