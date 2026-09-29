import { env } from "@/core/env";

import { fakeBillingAllowed } from "../env";
import type { PaymentProvider } from "../provider";
import { createCreemProvider } from "./creem";
import { createFakeBillingProvider } from "./fake";
import { createLemonSqueezyProvider } from "./lemonsqueezy";
import { createStripeProvider } from "./stripe";
import { createWaffoProvider } from "./waffo";

let cached: PaymentProvider | null | undefined;

/**
 * Whether the test-only fake provider is active. Env validation already rejects `fake` in the
 * production runtime, on Vercel, or in live mode; this checks the runtime environment once more,
 * and the fake routes use the result to decide whether to return 404.
 */
export function fakeBillingActive() {
  return env.BILLING_PROVIDER === "fake" && fakeBillingAllowed(process.env);
}

/**
 * The configured payment provider, dispatched on `BILLING_PROVIDER` (the default comes from
 * billing.provider in site.config.ts).
 * Returns null when keys are missing: the checkout and webhook endpoints return 503 and everything
 * else keeps working.
 * In production with paid plans, env validation requires the keys of the **active** provider, so
 * this never reaches null there.
 * To add a provider, change this function and billingProviderNames in env.ts; no other code needs
 * to change.
 */
export function getBillingProvider(): PaymentProvider | null {
  if (cached !== undefined) return cached;
  cached = createProvider();
  return cached;
}

function createProvider(): PaymentProvider | null {
  if (fakeBillingActive()) return createFakeBillingProvider();

  if (env.BILLING_PROVIDER === "stripe") {
    return env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET
      ? createStripeProvider({
          secretKey: env.STRIPE_SECRET_KEY,
          webhookSecret: env.STRIPE_WEBHOOK_SECRET,
        })
      : null;
  }

  if (env.BILLING_PROVIDER === "lemonsqueezy") {
    return env.LEMONSQUEEZY_API_KEY &&
      env.LEMONSQUEEZY_WEBHOOK_SECRET &&
      env.LEMONSQUEEZY_STORE_ID
      ? createLemonSqueezyProvider({
          apiKey: env.LEMONSQUEEZY_API_KEY,
          webhookSecret: env.LEMONSQUEEZY_WEBHOOK_SECRET,
          storeId: env.LEMONSQUEEZY_STORE_ID,
        })
      : null;
  }

  if (env.BILLING_PROVIDER === "waffo") {
    return env.WAFFO_MERCHANT_ID && env.WAFFO_PRIVATE_KEY
      ? createWaffoProvider({
          merchantId: env.WAFFO_MERCHANT_ID,
          privateKey: env.WAFFO_PRIVATE_KEY,
          mode: env.WAFFO_MODE,
        })
      : null;
  }

  return env.CREEM_API_KEY && env.CREEM_WEBHOOK_SECRET
    ? createCreemProvider({
        apiKey: env.CREEM_API_KEY,
        webhookSecret: env.CREEM_WEBHOOK_SECRET,
        mode: env.CREEM_MODE,
      })
    : null;
}
