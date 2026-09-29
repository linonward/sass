import { auth } from "@/core/auth/server";
import { openPortal } from "@/core/billing/checkout";
import { getBillingProvider } from "@/core/billing/providers";
import { getDb } from "@/core/db";

/** Redirect to the provider's customer portal (manage subscription, payment method, invoices). */
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
    ? // The provider may return a site-relative URL (fake); make it absolute.
      Response.redirect(new URL(result.url, request.url), 303)
    : Response.json({ error: result.error }, { status: result.status });
}
