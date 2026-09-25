import { fakeBillingActive } from "@/core/billing/providers";

// 模拟的客户门户（BILLING_PROVIDER=fake，只在本地和 CI 可用）。其他情况一律 404。
export async function GET(request: Request) {
  if (!fakeBillingActive()) return new Response("Not Found", { status: 404 });
  const customer = new URL(request.url).searchParams.get("customer") ?? "";
  const safe = customer.replace(/[^\w-]/g, "");
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fake customer portal</title></head>
<body style="font-family:system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1rem">
<h1>Fake customer portal</h1><p>Customer: <code>${safe}</code></p></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}
