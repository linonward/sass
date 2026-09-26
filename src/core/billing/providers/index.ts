import { env } from "@/core/env";

import { fakeBillingAllowed } from "../env";
import type { PaymentProvider } from "../provider";
import { createCreemProvider } from "./creem";
import { createFakeBillingProvider } from "./fake";

let cached: PaymentProvider | null | undefined;

/**
 * 是否启用了测试用的 fake 服务商。env 校验已经拒绝在生产运行时、Vercel 或 live 模式下设为 fake，
 * 这里按运行时环境再判断一次，fake 相关路由据此决定是否返回 404。
 */
export function fakeBillingActive() {
  return env.BILLING_PROVIDER === "fake" && fakeBillingAllowed(process.env);
}

/**
 * 当前配置的支付服务商（v1 只有 Creem；e2e 可切到 fake）。没配 key 时返回 null：
 * 结账和 webhook 接口返回 503，其他功能照常。生产环境有付费套餐时 env 校验会要求 key，不会走到 null。
 */
export function getBillingProvider(): PaymentProvider | null {
  if (cached !== undefined) return cached;
  if (fakeBillingActive()) {
    cached = createFakeBillingProvider();
    return cached;
  }
  cached =
    env.CREEM_API_KEY && env.CREEM_WEBHOOK_SECRET
      ? createCreemProvider({
          apiKey: env.CREEM_API_KEY,
          webhookSecret: env.CREEM_WEBHOOK_SECRET,
          mode: env.CREEM_MODE,
        })
      : null;
  return cached;
}
