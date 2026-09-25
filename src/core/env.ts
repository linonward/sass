import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

import { formatIssues } from "./config/format-issues";

type ServerShape = Record<string, z.ZodType>;
type RuntimeEnv = Record<string, string | undefined>;

/**
 * 只有 `enabled` 为 true 时才要求该变量；否则变量可以不填。
 * 用法：`OPENAI_API_KEY: requiredWhen(siteConfig.features.ai, z.string().min(1))`。
 */
export function requiredWhen<T extends z.ZodType>(enabled: boolean, schema: T) {
  return enabled ? schema : schema.optional();
}

/** 按给定 schema 校验环境变量。任一字段非法时抛错，并逐条列出变量名。 */
export function createAppEnv<TServer extends ServerShape>({
  server,
  runtimeEnv,
}: {
  server: TServer;
  runtimeEnv: RuntimeEnv;
}) {
  return createEnv({
    shared: {
      NODE_ENV: z
        .enum(["development", "test", "production"])
        .default("development"),
    },
    server,
    runtimeEnv,
    emptyStringAsUndefined: true,
    skipValidation: Boolean(runtimeEnv.SKIP_ENV_VALIDATION),
    onValidationError: (issues) => {
      throw new Error(
        `Invalid environment variables:\n${formatIssues(issues)}`,
      );
    },
  });
}

// 各模块在自己的任务里往 server 中添加变量；只属于某个 feature 的变量用 requiredWhen 包一层。
export const env = createAppEnv({
  server: {},
  runtimeEnv: process.env,
});
