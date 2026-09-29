import { auth } from "@/core/auth/server";
import { getCheckoutStatus } from "@/core/billing/status";
import { creditsEnabled, getBalance } from "@/core/credits";
import { getDb } from "@/core/db";

/**
 * Success-page polling: GET /api/billing/status?subscription_id=...|order_id=... (params the provider
 * appends on redirect), or ?plan=...&since=... (a fallback locator we add to the success URL at
 * checkout, used when the provider doesn't pass an ID). Only looks up the signed-in user's own
 * records; returns { status: pending | complete | failed, planId?, balance? }.
 */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const subscriptionId = params.get("subscription_id");
  const orderId = params.get("order_id");
  const planId = params.get("plan");
  const sinceMs = Number(params.get("since"));
  const since =
    Number.isFinite(sinceMs) && sinceMs > 0 ? new Date(sinceMs) : null;
  if (!subscriptionId && !orderId && !(planId && since)) {
    return Response.json({ error: "missing_reference" }, { status: 400 });
  }

  const result = await getCheckoutStatus({
    db: getDb(),
    userId: session.user.id,
    subscriptionId,
    orderId,
    planId,
    since,
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
