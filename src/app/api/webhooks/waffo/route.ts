import { getBillingProvider } from "@/core/billing/providers";
import { WAFFO_PROVIDER_ID } from "@/core/billing/providers/waffo";
import { processWebhook } from "@/core/billing/webhook";

/**
 * Waffo Pancake webhook：校验签名（按 WAFFO_MODE 的环境）后交给 handleBillingEvent。
 * 在 Pancake 后台的 Webhooks 里配置为 https://<domain>/api/webhooks/waffo。
 */
export async function POST(request: Request) {
  const provider = getBillingProvider();
  if (!provider || provider.id !== WAFFO_PROVIDER_ID) {
    return Response.json({ error: "billing_not_configured" }, { status: 503 });
  }
  return processWebhook(provider, request);
}
