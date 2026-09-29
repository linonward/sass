import {
  fakeBillingActive,
  getBillingProvider,
} from "@/core/billing/providers";
import { processWebhook } from "@/core/billing/webhook";

/**
 * Webhook for the fake provider (exists only when BILLING_PROVIDER=fake); goes through the same
 * processWebhook path as Creem.
 */
export async function POST(request: Request) {
  const provider = getBillingProvider();
  if (!fakeBillingActive() || !provider) {
    return new Response("Not Found", { status: 404 });
  }
  return processWebhook(provider, request);
}
