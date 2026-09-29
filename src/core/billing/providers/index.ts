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
 * 是否启用了测试用的 fake 服务商。env 校验已经拒绝在生产运行时、Vercel 或 live 模式下设为 fake，
 * 这里按运行时环境再判断一次，fake 相关路由据此决定是否返回 404。
 */
export function fakeBillingActive() {
  return env.BILLING_PROVIDER === "fake" && fakeBillingAllowed(process.env);
}

/**
 * 当前配置的支付服务商，按 `BILLING_PROVIDER` 分派（默认值来自 site.config.ts 的 billing.provider）。
 * 没配 key 时返回 null：结账和 webhook 接口返回 503，其他功能照常。
 * 生产环境有付费套餐时 env 校验会要求**生效**服务商的 key，不会走到 null。
 * 加服务商时改这里和 env.ts 的 billingProviderNames，其他代码不用动。
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
    return env.WAFFO_API_KEY &&
      env.WAFFO_PRIVATE_KEY &&
      env.WAFFO_PUBLIC_KEY &&
      env.WAFFO_MERCHANT_ID
      ? createWaffoProvider({
          apiKey: env.WAFFO_API_KEY,
          privateKey: env.WAFFO_PRIVATE_KEY,
          publicKey: env.WAFFO_PUBLIC_KEY,
          merchantId: env.WAFFO_MERCHANT_ID,
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
