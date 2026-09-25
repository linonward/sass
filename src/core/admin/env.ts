import { z } from "zod";

// 会被 next.config.ts 间接加载，那里不解析 `@/` 别名，只能用相对路径。
import { requiredWhen } from "../create-env";

type RuntimeEnv = Record<string, string | undefined>;

/** 逗号分隔的邮箱列表，去掉空格并转成小写。 */
export const adminEmailsSchema = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  )
  .pipe(z.array(z.email("must be comma-separated email addresses")).min(1));

/**
 * 后台模块的变量。
 * - `ADMIN_EMAILS`：逗号分隔的邮箱。用这些邮箱登录（邮箱已验证）时自动获得 admin 角色。
 *   开启 `features.admin` 时在 Vercel 生产环境必填，否则没有人能进入后台。
 */
export function adminServerEnv(
  runtimeEnv: RuntimeEnv,
  { enabled }: { enabled: boolean },
) {
  return {
    ADMIN_EMAILS: requiredWhen(
      enabled && runtimeEnv.VERCEL_ENV === "production",
      adminEmailsSchema,
    ),
  };
}
