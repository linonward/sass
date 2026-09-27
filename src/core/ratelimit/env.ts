import { z } from "zod";

// 会被 next.config.ts 间接加载，那里不解析 `@/` 别名，只能用相对路径。
import { requiredWhen } from "../create-env";

type RuntimeEnv = Record<string, string | undefined>;

/** `ALLOW_UNRATELIMITED` 的合法取值，其他值由 env 校验拒绝（0 / false 与不填等价）。 */
export const allowUnratelimitedValues = ["1", "true", "0", "false"] as const;

/**
 * 是否处于「自托管生产」：`NODE_ENV === "production"` 且不在 Vercel 上
 * （`next build` / `next start` / Docker）。
 *
 * Vercel 的部署无论生产还是预览都有 `VERCEL_ENV`，不算自托管：那里生产由下面的
 * `rateLimitServerEnv` 强制要求 Upstash 变量，预览则和本地一样跳过限流。
 */
export function isSelfHostedProduction(runtimeEnv: RuntimeEnv) {
  return !runtimeEnv.VERCEL_ENV && runtimeEnv.NODE_ENV === "production";
}

/** 显式放行「生产运行时不配 Redis」的开关是否打开：只有 `1` / `true` 算开启。 */
export function allowUnratelimited(runtimeEnv: RuntimeEnv) {
  const value = runtimeEnv.ALLOW_UNRATELIMITED;
  return value === "1" || value === "true";
}

/** Redis 是否配置齐了（两个变量都要有；只有一个或空串都算没配）。 */
export function upstashConfigured(runtimeEnv: RuntimeEnv) {
  return Boolean(
    runtimeEnv.UPSTASH_REDIS_REST_URL && runtimeEnv.UPSTASH_REDIS_REST_TOKEN,
  );
}

/**
 * 没有配置 Redis 时怎么处理（有没有配由 `upstashConfigured` 判断，这里只看策略）：
 * - `"allow"`：放行。本地、测试、CI、Vercel 预览，或显式设了 `ALLOW_UNRATELIMITED`；
 * - `"unavailable"`：拒绝请求（503）。自托管生产漏配 —— 那里没有平台侧的变量校验兜底，
 *   静默放行等于把 AI / 上传 / 结账的限流整个关掉，且只留一行容易淹没的 warn 日志。
 *
 * Vercel 生产也返回 `"unavailable"`，但那条路走不到：变量由下面的 schema 强制要求，缺了起不来。
 */
export function missingRedisPolicy(
  runtimeEnv: RuntimeEnv,
  { enabled }: { enabled: boolean },
): "allow" | "unavailable" {
  if (!enabled || allowUnratelimited(runtimeEnv)) return "allow";
  const required =
    runtimeEnv.VERCEL_ENV === "production" ||
    isSelfHostedProduction(runtimeEnv);
  return required ? "unavailable" : "allow";
}

/**
 * 限流模块的变量（Upstash Redis 的 REST 地址和 token）。
 * `required` 为 true 时（Vercel 生产环境且开启了 ai、upload 或 rateLimit）必填；
 * 其他环境可以不填，此时跳过限流 —— 但自托管生产会拒绝请求（见 `missingRedisPolicy`），
 * 本地、测试、CI 和 Vercel 预览照旧放行，`ALLOW_UNRATELIMITED` 可以显式放行自托管生产。
 */
export function rateLimitServerEnv(
  runtimeEnv: RuntimeEnv,
  { enabled }: { enabled: boolean },
) {
  const required = runtimeEnv.VERCEL_ENV === "production" && enabled;
  return {
    UPSTASH_REDIS_REST_URL: requiredWhen(
      required,
      z.url({ protocol: /^https$/ }),
    ),
    UPSTASH_REDIS_REST_TOKEN: requiredWhen(required, z.string().min(1)),
    ALLOW_UNRATELIMITED: z.enum(allowUnratelimitedValues).optional(),
  };
}
