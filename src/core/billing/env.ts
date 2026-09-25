import { z } from "zod";

// 会被 next.config.ts 间接加载，那里不解析 `@/` 别名，只能用相对路径。
import { requiredWhen } from "../create-env";

type RuntimeEnv = Record<string, string | undefined>;

/** Creem 的环境：test 走 test-api.creem.io（沙盒，测试卡），live 走 api.creem.io（真实扣款）。 */
export const creemModes = ["test", "live"] as const;
export type CreemMode = (typeof creemModes)[number];

export const billingProviders = ["creem", "fake"] as const;
export type BillingProviderName = (typeof billingProviders)[number];

/**
 * 是否允许使用测试用的 fake 支付服务商。只在本地和 CI 允许：
 * Vercel 上（任何环境）或 CREEM_MODE=live 时一律不允许，避免有人误开后免费拿到套餐和积分。
 */
export function fakeBillingAllowed(runtimeEnv: RuntimeEnv) {
  return !runtimeEnv.VERCEL_ENV && runtimeEnv.CREEM_MODE !== "live";
}

/**
 * 收款模块的变量。
 * - `CREEM_API_KEY`、`CREEM_WEBHOOK_SECRET`：站点有付费套餐时，在 Vercel 生产环境必填；
 *   本地、CI 和预览可以不填，此时结账和 webhook 接口返回 503，其他功能不受影响。
 * - `CREEM_MODE`：默认 test。切到真实收款必须显式设为 live，并换成生产模式的 key、secret 和产品 ID。
 * - `BILLING_PROVIDER`：默认 creem；fake 只在本地和 CI 可用（见 fakeBillingAllowed）。
 * - `BILLING_SUCCESS_TIMEOUT_MS`：成功页等待 webhook 的时长，默认 60 秒。
 */
export function billingServerEnv(
  runtimeEnv: RuntimeEnv,
  { hasPaidPlans }: { hasPaidPlans: boolean },
) {
  const required = runtimeEnv.VERCEL_ENV === "production" && hasPaidPlans;
  return {
    CREEM_API_KEY: requiredWhen(required, z.string().min(1)),
    CREEM_WEBHOOK_SECRET: requiredWhen(required, z.string().min(1)),
    CREEM_MODE: z.enum(creemModes).default("test"),
    // fake 只用于 e2e：结账页和 webhook 都由站内的测试路由模拟。不允许的环境里设成 fake 会启动失败。
    BILLING_PROVIDER: z
      .enum(billingProviders)
      .default("creem")
      .refine((value) => value !== "fake" || fakeBillingAllowed(runtimeEnv), {
        message: 'must be "creem" on Vercel or when CREEM_MODE=live',
      }),
    // 成功页等待 webhook 的时长，超过后提示联系支持。e2e 里调短。
    BILLING_SUCCESS_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(60_000),
  };
}
