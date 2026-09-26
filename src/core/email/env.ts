import { z } from "zod";

// 会被 next.config.ts 间接加载，那里不解析 `@/` 别名，只能用相对路径。
import { requiredWhen } from "../create-env";

type RuntimeEnv = Record<string, string | undefined>;

export const emailTransports = ["resend", "console", "file"] as const;
export type EmailTransport = (typeof emailTransports)[number];

/** `ALLOW_NON_RESEND_EMAIL` 的合法取值，其他值由 env 校验拒绝（0 / false 与不填等价）。 */
export const nonResendEmailOptInValues = ["1", "true", "0", "false"] as const;

/** 显式放行「生产 + 非 resend 传输」的开关是否打开：只有 `1` / `true` 算开启。 */
function nonResendEmailOptIn(runtimeEnv: RuntimeEnv) {
  const value = runtimeEnv.ALLOW_NON_RESEND_EMAIL;
  return value === "1" || value === "true";
}

/**
 * 是否处于生产运行时：Vercel 的生产环境，或 `NODE_ENV === "production"`
 * （`next build`、`next start`、Docker 里都是，Vercel 的预览部署同样是生产构建）。
 */
export function isProductionEmailRuntime(runtimeEnv: RuntimeEnv) {
  return (
    runtimeEnv.VERCEL_ENV === "production" ||
    runtimeEnv.NODE_ENV === "production"
  );
}

/**
 * 生产运行时是否允许 `console` / `file` 这类非 resend 的发送方式。
 *
 * 默认不允许：这两种方式是给本地开发和测试看的 —— `console` 把整封邮件（登录验证码就在正文里）
 * 打进服务端日志，`file` 把它写到磁盘上的 `.tmp/emails/`，而且都不需要发信服务商的 key。
 * 在生产上等于把登录凭据留在部署环境里，任何一个能看到日志或容器文件系统的人都能拿去登录别人的账号。
 *
 * 显式设置 `ALLOW_NON_RESEND_EMAIL=1` 只放开这一条判断：CI 的 e2e 跑在生产构建上（`next start`）、
 * 从 `.tmp/emails/` 读验证码，必须靠它。它不放开发信服务商那一步，也不改发送方式的默认选择逻辑。
 */
export function nonResendEmailAllowed(runtimeEnv: RuntimeEnv) {
  return (
    !isProductionEmailRuntime(runtimeEnv) || nonResendEmailOptIn(runtimeEnv)
  );
}

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

/**
 * 邮件模块的变量。
 * - `EMAIL_TRANSPORT`：不填时按 NODE_ENV 取默认值；生产运行时只允许 `resend`
 *   （见 nonResendEmailAllowed），设成 `console` / `file` 会启动报错。
 * - `ALLOW_NON_RESEND_EMAIL`：可选，默认关闭。显式设为 1 / true 时放行生产环境下的
 *   `console` / `file`（CI 的 e2e 需要，因为 e2e 跑在生产构建上）。
 * - `RESEND_API_KEY`：只有发送方式为 resend 时才要求。
 */
export function emailServerEnv(runtimeEnv: RuntimeEnv) {
  return {
    EMAIL_TRANSPORT: z
      .enum(emailTransports)
      .optional()
      .refine(
        (value) =>
          value === undefined ||
          value === "resend" ||
          nonResendEmailAllowed(runtimeEnv),
        {
          message:
            'must be "resend" in a production runtime (VERCEL_ENV=production or NODE_ENV=production); set ALLOW_NON_RESEND_EMAIL=1 to allow console/file there',
        },
      ),
    ALLOW_NON_RESEND_EMAIL: z.enum(nonResendEmailOptInValues).optional(),
    RESEND_API_KEY: requiredWhen(
      resolveEmailTransport(runtimeEnv) === "resend",
      z.string().startsWith("re_", 'must be a Resend API key ("re_...")'),
    ),
  };
}
