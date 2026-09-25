import { auth } from "@/core/auth/server";
import { openPortal } from "@/core/billing/checkout";
import { getBillingProvider } from "@/core/billing/providers";
import { getDb } from "@/core/db";

/** 跳转到服务商的客户门户（管理订阅、付款方式、发票）。 */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await openPortal({
    db: getDb(),
    provider: getBillingProvider(),
    userId: session.user.id,
  });
  return result.ok
    ? Response.redirect(result.url, 303)
    : Response.json({ error: result.error }, { status: result.status });
}
