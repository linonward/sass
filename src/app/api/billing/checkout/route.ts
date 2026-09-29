import { auth } from "@/core/auth/server";
import { billingOrigin, startCheckout } from "@/core/billing/checkout";
import { getBillingProvider } from "@/core/billing/providers";
import { getDb } from "@/core/db";
import { checkRateLimit, getClientIp } from "@/core/ratelimit";

import siteConfig from "../../../../../site.config";

/** Create a checkout session. Body: { planId, locale? }; returns { url } for the client to redirect to. */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    planId?: unknown;
    locale?: unknown;
  } | null;

  const result = await startCheckout({
    db: getDb(),
    provider: getBillingProvider(),
    user: { id: session.user.id, email: session.user.email },
    planId: body?.planId,
    locale: body?.locale,
    origin: billingOrigin(request, process.env, siteConfig.domain),
    ip: getClientIp(request.headers),
    checkRateLimit,
  });
  if (result.ok) return Response.json({ url: result.url });
  return Response.json(
    { error: result.error },
    {
      status: result.status,
      ...(result.retryAfter && {
        headers: { "retry-after": String(result.retryAfter) },
      }),
    },
  );
}
