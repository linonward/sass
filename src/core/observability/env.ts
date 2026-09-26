import { z } from "zod";

// 会被 next.config.ts 间接加载，那里不解析 `@/` 别名，只能用相对路径。
import { requiredWhen } from "../create-env";

type RuntimeEnv = Record<string, string | undefined>;

/**
 * Sentry 的构建期变量，只用来上传 source map（三项都填了才上传），不填不影响错误上报。
 * - `SENTRY_AUTH_TOKEN`：Sentry 的 Organization Auth Token。
 * - `SENTRY_ORG` / `SENTRY_PROJECT`：组织和项目的 slug。
 */
export function observabilityServerEnv() {
  return {
    SENTRY_AUTH_TOKEN: z.string().min(1).optional(),
    SENTRY_ORG: z.string().min(1).optional(),
    SENTRY_PROJECT: z.string().min(1).optional(),
  };
}

/**
 * 浏览器也要用的变量。
 * - `NEXT_PUBLIC_SENTRY_DSN`：Sentry 项目的 DSN，开启 `observability.sentry` 时必填。
 */
export function observabilityClientEnv({ sentry }: { sentry: boolean }) {
  return {
    NEXT_PUBLIC_SENTRY_DSN: requiredWhen(
      sentry,
      z.url({ protocol: /^https?$/ }),
    ),
  };
}

/** 三项都填了才上传 source map。 */
export function canUploadSourceMaps(runtimeEnv: RuntimeEnv) {
  return Boolean(
    runtimeEnv.SENTRY_AUTH_TOKEN &&
    runtimeEnv.SENTRY_ORG &&
    runtimeEnv.SENTRY_PROJECT,
  );
}
