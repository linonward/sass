import { z } from "zod";

// 会被 next.config.ts 间接加载，那里不解析 `@/` 别名，只能用相对路径。
import { requiredWhen } from "../create-env";

type RuntimeEnv = Record<string, string | undefined>;

/** Creem 的环境：test 走 test-api.creem.io（沙盒，测试卡），live 走 api.creem.io（真实扣款）。 */
export const creemModes = ["test", "live"] as const;
export type CreemMode = (typeof creemModes)[number];

/**
 * 收款模块的变量。
 * - `CREEM_API_KEY`、`CREEM_WEBHOOK_SECRET`：站点有付费套餐时，在 Vercel 生产环境必填；
 *   本地、CI 和预览可以不填，此时结账和 webhook 接口返回 503，其他功能不受影响。
 * - `CREEM_MODE`：默认 test。切到真实收款必须显式设为 live，并换成生产模式的 key、secret 和产品 ID。
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
  };
}
