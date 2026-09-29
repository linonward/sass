import { getBillingProvider } from "@/core/billing/providers";
import { WAFFO_PROVIDER_ID } from "@/core/billing/providers/waffo";
import { processWebhook } from "@/core/billing/webhook";

/**
 * Waffo webhook：校验签名后交给 handleBillingEvent，回复由 adapter 签名（Waffo 要求）。
 * 地址由结账时的 notifyUrl 带给 Waffo（https://<domain>/api/webhooks/waffo）；
 * 退款通知在 Waffo Portal 里把全局通知地址也配成这个。
 */
export async function POST(request: Request) {
  const provider = getBillingProvider();
  if (!provider || provider.id !== WAFFO_PROVIDER_ID) {
    return Response.json({ error: "billing_not_configured" }, { status: 503 });
  }
  return processWebhook(provider, request);
}
