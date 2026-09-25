import {
  fakeBillingActive,
  getBillingProvider,
} from "@/core/billing/providers";
import { processWebhook } from "@/core/billing/webhook";

/** fake 服务商的 webhook（只在 BILLING_PROVIDER=fake 时存在），和 Creem 走同一条 processWebhook 链路。 */
export async function POST(request: Request) {
  const provider = getBillingProvider();
  if (!fakeBillingActive() || !provider) {
    return new Response("Not Found", { status: 404 });
  }
  return processWebhook(provider, request);
}
