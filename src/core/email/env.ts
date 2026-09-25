import { z } from "zod";

// 会被 next.config.ts 间接加载，那里不解析 `@/` 别名，只能用相对路径。
import { requiredWhen } from "../create-env";

type RuntimeEnv = Record<string, string | undefined>;

export const emailTransports = ["resend", "console", "file"] as const;
export type EmailTransport = (typeof emailTransports)[number];

/**
 * 邮件发送方式：显式设置的 `EMAIL_TRANSPORT` 优先；
 * 未设置时生产环境（含 Vercel 预览）用 resend，其他环境打印到控制台。
 */
export function resolveEmailTransport(runtimeEnv: RuntimeEnv): string {
  return (
    runtimeEnv.EMAIL_TRANSPORT ||
    (runtimeEnv.NODE_ENV === "production" ? "resend" : "console")
  );
}

/** 邮件模块的变量：只有发送方式为 resend 时才要求 `RESEND_API_KEY`。 */
export function emailServerEnv(runtimeEnv: RuntimeEnv) {
  return {
    EMAIL_TRANSPORT: z.enum(emailTransports).optional(),
    RESEND_API_KEY: requiredWhen(
      resolveEmailTransport(runtimeEnv) === "resend",
      z.string().startsWith("re_", 'must be a Resend API key ("re_...")'),
    ),
  };
}
