import { z } from "zod";

// 会被 next.config.ts 间接加载，那里不解析 `@/` 别名，只能用相对路径。
import { requiredWhen } from "../create-env";

type RuntimeEnv = Record<string, string | undefined>;

/** Creem 的环境：test 走 test-api.creem.io（沙盒，测试卡），live 走 api.creem.io（真实扣款）。 */
export const creemModes = ["test", "live"] as const;
export type CreemMode = (typeof creemModes)[number];

export const billingProviders = ["creem", "fake"] as const;
export type BillingProviderName = (typeof billingProviders)[number];

/** `ALLOW_FAKE_BILLING` 的合法取值，其他值由 env 校验拒绝（0 / false 与不填等价）。 */
export const fakeBillingOptInValues = ["1", "true", "0", "false"] as const;

/** 只有 `next dev`（development）和测试（test）算非生产运行时。 */
export const nonProductionNodeEnvs = ["development", "test"] as const;

/** 显式放行 fake 的开关是否打开：只有 `1` / `true` 算开启。 */
function fakeBillingOptIn(runtimeEnv: RuntimeEnv) {
  const value = runtimeEnv.ALLOW_FAKE_BILLING;
  return value === "1" || value === "true";
}

/** `NODE_ENV` 是否明确是非生产运行时；没设置时按生产处理（宁可拒绝）。 */
function isNonProductionRuntime(runtimeEnv: RuntimeEnv) {
  return nonProductionNodeEnvs.some((value) => value === runtimeEnv.NODE_ENV);
}

/**
 * 是否允许使用测试用的 fake 支付服务商。fake 的结账页和 webhook 都是站内路由，
 * 一旦在真实部署里可用，任何人都能走假结账白拿套餐和积分，所以默认只在本地（`next dev`）允许，
 * 三层判断缺一不可：
 * - 不在 Vercel 上（任何 VERCEL_ENV）——硬锁，部署到 Vercel 的站点一律用真实服务商；
 * - `CREEM_MODE !== "live"` ——硬锁，真实扣款模式绝不能落在假支付上；
 * - `NODE_ENV` 是 development / test —— `next build`、`next start`、Docker 里都是 production，
 *   自托管生产默认拒绝（收紧前这一条缺失：自托管的 `next start` 会静默放行 fake）。
 *   `NODE_ENV` 没设置时按生产处理，避免自建服务忘了设置就默认放行。
 *
 * 显式设置 `ALLOW_FAKE_BILLING=1` 只放开第三条：CI 的 e2e 跑在生产构建上（`next start`）必须靠它，
 * 自托管部署只有明确要用模拟支付时才设。前两条是硬锁，设了它也不会放开。
 */
export function fakeBillingAllowed(runtimeEnv: RuntimeEnv) {
  if (runtimeEnv.VERCEL_ENV) return false;
  if (runtimeEnv.CREEM_MODE === "live") return false;
  return fakeBillingOptIn(runtimeEnv) || isNonProductionRuntime(runtimeEnv);
}

/**
 * 收款模块的变量。
 * - `CREEM_API_KEY`、`CREEM_WEBHOOK_SECRET`：站点有付费套餐时，在 Vercel 生产环境必填；
 *   本地、CI 和预览可以不填，此时结账和 webhook 接口返回 503，其他功能不受影响。
 * - `CREEM_MODE`：默认 test。切到真实收款必须显式设为 live，并换成生产模式的 key、secret 和产品 ID。
 * - `BILLING_PROVIDER`：默认 creem；fake 只在本地和 CI 可用（见 fakeBillingAllowed）。
 * - `ALLOW_FAKE_BILLING`：可选，默认关闭。显式设为 1 / true 时允许 fake（CI 的 e2e 需要，
 *   因为 e2e 跑在生产构建上）；Vercel 和 CREEM_MODE=live 下设置也不会放行。
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
    // fake 只用于 e2e 和本地：结账页和 webhook 都由站内的测试路由模拟。
    // 不允许的环境里（生产构建、Vercel、CREEM_MODE=live）设成 fake 会启动失败，见 fakeBillingAllowed。
    BILLING_PROVIDER: z
      .enum(billingProviders)
      .default("creem")
      .refine((value) => value !== "fake" || fakeBillingAllowed(runtimeEnv), {
        message:
          'must be "creem" in a production runtime or on Vercel or when CREEM_MODE=live (set ALLOW_FAKE_BILLING=1 to override the production check)',
      }),
    // 显式放行 fake（可选，默认关闭）。只接受 1 / true / 0 / false：写错时启动即报错，不静默当成关闭。
    ALLOW_FAKE_BILLING: z.enum(fakeBillingOptInValues).optional(),
    // 成功页等待 webhook 的时长，超过后提示联系支持。e2e 里调短。
    BILLING_SUCCESS_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(60_000),
  };
}
