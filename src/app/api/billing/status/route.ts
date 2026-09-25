import { auth } from "@/core/auth/server";
import { getCheckoutStatus } from "@/core/billing/status";
import { creditsEnabled, getBalance } from "@/core/credits";
import { getDb } from "@/core/db";

/**
 * 成功页轮询：GET /api/billing/status?subscription_id=...|order_id=...（服务商回跳时附带的参数）。
 * 只查当前登录用户自己的记录；返回 { status: pending | complete | failed, planId?, balance? }。
 */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const subscriptionId = params.get("subscription_id");
  const orderId = params.get("order_id");
  if (!subscriptionId && !orderId) {
    return Response.json({ error: "missing_reference" }, { status: 400 });
  }

  const result = await getCheckoutStatus({
    db: getDb(),
    userId: session.user.id,
    subscriptionId,
    orderId,
  });
  const balance =
    result.status === "complete" && creditsEnabled
      ? await getBalance(session.user.id)
      : undefined;
  return Response.json(
    { ...result, balance },
    { headers: { "cache-control": "no-store" } },
  );
}
