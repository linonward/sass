import { z } from "zod";

// 会被 next.config.ts 间接加载，那里不解析 `@/` 别名，只能用相对路径。
import { requiredWhen } from "../create-env";

type RuntimeEnv = Record<string, string | undefined>;

/**
 * 上传模块的变量（Cloudflare R2）。
 * - `R2_ACCOUNT_ID`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`R2_BUCKET`：
 *   开启 `features.upload` 时在 Vercel 生产环境必填；其他环境可以不填，此时上传接口返回 503。
 * - `R2_PUBLIC_URL`：bucket 的公开域名（例如 https://files.example.com），只在 `upload.public` 为 true 时需要。
 */
export function uploadServerEnv(
  runtimeEnv: RuntimeEnv,
  { enabled, isPublic }: { enabled: boolean; isPublic: boolean },
) {
  const required = runtimeEnv.VERCEL_ENV === "production" && enabled;
  return {
    R2_ACCOUNT_ID: requiredWhen(
      required,
      z.string().regex(/^[0-9a-f]{32}$/, "must be a 32-character account ID"),
    ),
    R2_ACCESS_KEY_ID: requiredWhen(required, z.string().min(1)),
    R2_SECRET_ACCESS_KEY: requiredWhen(required, z.string().min(1)),
    R2_BUCKET: requiredWhen(required, z.string().min(1)),
    R2_PUBLIC_URL: requiredWhen(
      required && isPublic,
      z
        .url({ protocol: /^https$/ })
        .refine((value) => !new URL(value).pathname.slice(1), {
          message: 'must be an origin such as "https://files.example.com"',
        }),
    ),
  };
}
