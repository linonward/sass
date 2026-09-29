import { z } from "zod";

// 会被 next.config.ts 间接加载，那里不解析 `@/` 别名，只能用相对路径。
import { requiredWhen } from "../create-env";

type RuntimeEnv = Record<string, string | undefined>;

/** Creem 的环境：test 走 test-api.creem.io（沙盒，测试卡），live 走 api.creem.io（真实扣款）。 */
export const creemModes = ["test", "live"] as const;
export type CreemMode = (typeof creemModes)[number];

/**
 * Waffo Pancake 的环境：test（测试卡，不真实扣款）/ prod（真实收款）。两边的商户私钥、产品 ID
 * 互不通用；webhook 也按这个环境验签，另一个环境的事件一律拒收（见 providers/waffo.ts）。
 */
export const waffoModes = ["test", "prod"] as const;
export type WaffoMode = (typeof waffoModes)[number];

/** 可选的支付服务商。`site.config.ts` 的 `billing.provider` 从这里取值，实现见 ./providers/。 */
export const billingProviderNames = [
  "creem",
  "stripe",
  "lemonsqueezy",
  "waffo",
] as const;
export type BillingProviderName = (typeof billingProviderNames)[number];

/** `BILLING_PROVIDER` 的合法取值：真实服务商 + 测试用的 fake。 */
export const billingProviders = [...billingProviderNames, "fake"] as const;

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

/** 真实扣款的 Stripe 密钥（`sk_live_` 是标准密钥，`rk_live_` 是受限密钥）。 */
function isLiveStripeKey(runtimeEnv: RuntimeEnv) {
  return /^(sk|rk)_live_/.test(runtimeEnv.STRIPE_SECRET_KEY ?? "");
}

/**
 * 是否允许使用测试用的 fake 支付服务商。fake 的结账页和 webhook 都是站内路由，
 * 一旦在真实部署里可用，任何人都能走假结账白拿套餐和积分，所以默认只在本地（`next dev`）允许，
 * 四层判断缺一不可：
 * - 不在 Vercel 上（任何 VERCEL_ENV）——硬锁，部署到 Vercel 的站点一律用真实服务商；
 * - `CREEM_MODE !== "live"` ——硬锁，真实扣款模式绝不能落在假支付上；
 * - `STRIPE_SECRET_KEY` 不是 live 密钥 ——硬锁，同上，换了服务商也一样；
 * - `WAFFO_MODE !== "prod"` ——硬锁，同上；
 * - `NODE_ENV` 是 development / test —— `next build`、`next start`、Docker 里都是 production，
 *   自托管生产默认拒绝（收紧前这一条缺失：自托管的 `next start` 会静默放行 fake）。
 *   `NODE_ENV` 没设置时按生产处理，避免自建服务忘了设置就默认放行。
 *
 * Lemon Squeezy **没有**对应的硬锁：它没有 test / live 这个环境变量（测试模式与真实收款是
 * 店铺上的一个开关），API key 也没有可识别的模式标记（两种模式下前缀完全一样），
 * `LEMONSQUEEZY_STORE_ID` 同样不区分。造不出可靠判据，就不写假判据 —— 与其按猜测拦，
 * 不如让第一条（不在 Vercel 上）和第四条（生产运行时默认拒绝）继续生效。
 *
 * 显式设置 `ALLOW_FAKE_BILLING=1` 只放开第四条：CI 的 e2e 跑在生产构建上（`next start`）必须靠它，
 * 自托管部署只有明确要用模拟支付时才设。前三条是硬锁，设了它也不会放开。
 */
export function fakeBillingAllowed(runtimeEnv: RuntimeEnv) {
  if (runtimeEnv.VERCEL_ENV) return false;
  if (runtimeEnv.CREEM_MODE === "live") return false;
  if (isLiveStripeKey(runtimeEnv)) return false;
  if (runtimeEnv.WAFFO_MODE === "prod") return false;
  return fakeBillingOptIn(runtimeEnv) || isNonProductionRuntime(runtimeEnv);
}

/**
 * 收款模块的变量。
 * - 生效的服务商由 `BILLING_PROVIDER` 决定，默认值是 `site.config.ts` 的 `billing.provider`
 *   （参数 `provider`）；只有**生效**的那家服务商的密钥在生产环境必填。
 * - `CREEM_API_KEY`、`CREEM_WEBHOOK_SECRET` / `STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET` /
 *   `LEMONSQUEEZY_API_KEY`、`LEMONSQUEEZY_WEBHOOK_SECRET`、`LEMONSQUEEZY_STORE_ID`：
 *   站点有付费套餐、在 Vercel 生产环境且服务商选到它时必填；否则可以不填，
 *   此时结账和 webhook 接口返回 503，其他功能不受影响。Lemon Squeezy 的 STORE_ID 也要填：
 *   建结账会话必须带上 store 关系。
 * - `CREEM_MODE`：默认 test。切到真实收款必须显式设为 live，并换成生产模式的 key、secret 和产品 ID。
 * - `WAFFO_MERCHANT_ID`、`WAFFO_PRIVATE_KEY`：Waffo Pancake 的商户 ID（`MER_`）和 API 私钥，
 *   生效服务商是 waffo 时按同样规则必填。`WAFFO_MODE` 默认 test，真实收款显式设 prod，
 *   两个环境的私钥和产品 ID 互不通用。
 * - `BILLING_PROVIDER`：默认取 `site.config.ts` 的 billing.provider（见下面的 provider 参数）；
 *   fake 只在本地和 CI 可用（见 fakeBillingAllowed）。
 * - `ALLOW_FAKE_BILLING`：可选，默认关闭。显式设为 1 / true 时允许 fake（CI 的 e2e 需要，
 *   因为 e2e 跑在生产构建上）；Vercel、CREEM_MODE=live 和 live 的 Stripe 密钥下设置也不会放行。
 * - `BILLING_SUCCESS_TIMEOUT_MS`：成功页等待 webhook 的时长，默认 60 秒。
 */
export function billingServerEnv(
  runtimeEnv: RuntimeEnv,
  {
    hasPaidPlans,
    provider,
  }: { hasPaidPlans: boolean; provider: BillingProviderName },
) {
  const required = runtimeEnv.VERCEL_ENV === "production" && hasPaidPlans;
  // 必填的密钥按**实际生效**的服务商判断：BILLING_PROVIDER 显式设置时以它为准（默认值是 provider）。
  // 不按选中的服务商区分的话，用 Creem 的站点会被要求填 Stripe 的密钥，部署直接起不来。
  const selected = runtimeEnv.BILLING_PROVIDER ?? provider;
  const requiredFor = (name: BillingProviderName) =>
    required && selected === name;
  return {
    CREEM_API_KEY: requiredWhen(requiredFor("creem"), z.string().min(1)),
    CREEM_WEBHOOK_SECRET: requiredWhen(requiredFor("creem"), z.string().min(1)),
    // Lemon Squeezy 的三个变量：建结账会话要带 store 关系，所以 STORE_ID 和两个密钥一样必填。
    LEMONSQUEEZY_API_KEY: requiredWhen(
      requiredFor("lemonsqueezy"),
      z.string().min(1),
    ),
    LEMONSQUEEZY_WEBHOOK_SECRET: requiredWhen(
      requiredFor("lemonsqueezy"),
      z.string().min(1),
    ),
    LEMONSQUEEZY_STORE_ID: requiredWhen(
      requiredFor("lemonsqueezy"),
      z.string().min(1),
    ),
    CREEM_MODE: z.enum(creemModes).default("test"),
    // Waffo Pancake：Dashboard → Integration（Settings → Developers）里的商户 ID 和 API 私钥。
    // 私钥 PEM、一行 Base64、带字面 \n 的都行（官方 SDK 会规范化）。
    WAFFO_MERCHANT_ID: requiredWhen(requiredFor("waffo"), z.string().min(1)),
    WAFFO_PRIVATE_KEY: requiredWhen(requiredFor("waffo"), z.string().min(1)),
    WAFFO_MODE: z.enum(waffoModes).default("test"),
    // Stripe 的密钥是 sk_/rk_ 开头（测试模式 sk_test_，真实扣款 sk_live_），
    // secret 是 `stripe webhook` 或控制台给的 whsec_，和 Creem 的不通用。
    STRIPE_SECRET_KEY: requiredWhen(requiredFor("stripe"), z.string().min(1)),
    STRIPE_WEBHOOK_SECRET: requiredWhen(
      requiredFor("stripe"),
      z.string().min(1),
    ),
    // fake 只用于 e2e 和本地：结账页和 webhook 都由站内的测试路由模拟。
    // 不允许的环境里（生产构建、Vercel、CREEM_MODE=live、live 的 Stripe 密钥）设成 fake 会启动失败，
    // 见 fakeBillingAllowed。
    BILLING_PROVIDER: z
      .enum(billingProviders)
      .default(provider)
      .refine((value) => value !== "fake" || fakeBillingAllowed(runtimeEnv), {
        message:
          'must be "creem", "stripe", "lemonsqueezy" or "waffo" in a production runtime, on Vercel, when CREEM_MODE=live or WAFFO_MODE=prod, or with a live Stripe secret key (set ALLOW_FAKE_BILLING=1 to override the production check)',
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
