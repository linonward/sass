import { env } from "@/core/env";

import type { PaymentProvider } from "../provider";
import { createCreemProvider } from "./creem";

let cached: PaymentProvider | null | undefined;

/**
 * 当前配置的支付服务商（v1 只有 Creem）。没配 key 时返回 null：结账和 webhook 接口
 * 返回 503，其他功能照常。生产环境有付费套餐时 env 校验会要求 key，不会走到 null。
 */
export function getBillingProvider(): PaymentProvider | null {
  if (cached !== undefined) return cached;
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
