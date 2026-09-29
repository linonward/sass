import { auth } from "@/core/auth/server";
import {
  fakeBillingActive,
  getBillingProvider,
} from "@/core/billing/providers";
import {
  deliverFakeWebhooks,
  fakePayment,
  verifyFakeSession,
} from "@/core/billing/providers/fake";
import type { FakeProvider } from "@/core/billing/testing/fake-provider";

// Simulated checkout page (BILLING_PROVIDER=fake, local and CI only). 404 in every other case.
const notFound = () => new Response("Not Found", { status: 404 });

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

export async function GET(request: Request) {
  if (!fakeBillingActive()) return notFound();
  const token = new URL(request.url).searchParams.get("token");
  const session = verifyFakeSession(token);
  if (!session) return new Response("Invalid checkout", { status: 400 });

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Fake checkout</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family:system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1rem">
<h1>Fake checkout</h1>
<p>Test-only payment page. Plan: <strong>${escape(session.planId)}</strong></p>
<form method="post">
<input type="hidden" name="token" value="${escape(token!)}">
<p><label>Webhook delay (ms) <input name="delay" type="number" min="0" value="0"></label></p>
<p><label><input type="radio" name="webhook" value="send" checked> Send webhook</label><br>
<label><input type="radio" name="webhook" value="skip"> Don't send webhook</label></p>
<button type="submit">Pay</button>
</form></body></html>`;
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

/**
 * "Pay": redirect back to the success page and push the event to our own webhook after the
 * configured delay (or not at all, to simulate a lost webhook).
 */
export async function POST(request: Request) {
  if (!fakeBillingActive()) return notFound();
  const form = await request.formData();
  const session = verifyFakeSession(String(form.get("token") ?? ""));
  if (!session) return new Response("Invalid checkout", { status: 400 });

  // You can only pay for yourself, and the return URL must be on this site.
  const user = await auth.api.getSession({ headers: request.headers });
  if (user?.user.id !== session.userId) {
    return new Response("Forbidden", { status: 403 });
  }
  const origin = new URL(request.url).origin;
  const success = new URL(session.successUrl);
  if (success.origin !== origin) {
    return new Response("Invalid return URL", { status: 400 });
  }

  const provider = getBillingProvider() as FakeProvider;
  const payment = fakePayment(provider, session);
  if (!payment) return new Response("Invalid plan", { status: 400 });

  if (form.get("webhook") !== "skip") {
    const delay = Math.min(Math.max(Number(form.get("delay")) || 0, 0), 60_000);
    setTimeout(() => {
      deliverFakeWebhooks(provider, origin, payment.events).catch((error) =>
        console.error("[billing:fake] webhook delivery failed", error),
      );
    }, delay);
  }

  for (const [key, value] of Object.entries(payment.returnParams)) {
    success.searchParams.set(key, value);
  }
  return Response.redirect(success, 303);
}
