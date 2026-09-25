import { auth } from "@/core/auth/server";
import { billingOrigin, startCheckout } from "@/core/billing/checkout";
import { getBillingProvider } from "@/core/billing/providers";
import { getDb } from "@/core/db";

import siteConfig from "../../../../../site.config";

/** 创建结账会话。body：{ planId, locale? }；返回 { url }，由前端跳转。 */
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
  });
  return result.ok
    ? Response.json({ url: result.url })
    : Response.json({ error: result.error }, { status: result.status });
}
