import { z } from "zod";

// 会被 next.config.ts 间接加载，那里不解析 `@/` 别名，只能用相对路径。
import { requiredWhen } from "../create-env";

type RuntimeEnv = Record<string, string | undefined>;

/**
 * 限流模块的变量（Upstash Redis 的 REST 地址和 token）。
 * `required` 为 true 时（Vercel 生产环境且开启了 ai、upload 或 rateLimit）必填；
 * 其他环境可以不填，此时跳过限流并打印一次警告。
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
  };
}
