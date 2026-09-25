import type { Database } from "@/core/db";

import { handleBillingEvent } from "./handle-event";
import { WebhookVerificationError, type PaymentProvider } from "./provider";

/**
 * webhook 路由的完整处理：校验签名 → 解析事件 → handleBillingEvent，并转换成 HTTP 响应。
 * - 401：签名错误，不写库；服务商不应重试。
 * - 200：已处理、重复事件、不关心的事件类型、用户已删除。
 * - 500：处理失败（包括钩子失败、暂时找不到用户），事务已回滚，等待服务商重试。
 * T303 的路由直接 `return processWebhook(creem, request)`。
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
      return Response.json({ error: "invalid_signature" }, { status: 401 });
    }
    throw error;
  }

  const event = provider.parseEvent(payload);
  if (!event) return Response.json({ status: "ignored" });

  try {
    const result = await handleBillingEvent(event, options);
    return Response.json(result);
  } catch (error) {
    console.error(
      `[billing] failed to handle ${event.provider}/${event.eventId}`,
      error,
    );
    return Response.json({ error: "processing_failed" }, { status: 500 });
  }
}
