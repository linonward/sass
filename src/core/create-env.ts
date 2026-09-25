import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

import { formatIssues } from "./config/format-issues";

type ServerShape = Record<string, z.ZodType>;
type RuntimeEnv = Record<string, string | undefined>;

const nodeEnvSchema = z
  .enum(["development", "test", "production"])
  .default("development");

// createEnv 的推断在泛型包装里会退化成 unknown，这里显式写出结果类型。
type AppEnv<TServer extends ServerShape> = Readonly<
  { [K in keyof TServer]: z.output<TServer[K]> } & {
    NODE_ENV: z.output<typeof nodeEnvSchema>;
  }
>;

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
}): AppEnv<TServer> {
  return createEnv({
    shared: { NODE_ENV: nodeEnvSchema },
    server,
    runtimeEnv,
    emptyStringAsUndefined: true,
    skipValidation: Boolean(runtimeEnv.SKIP_ENV_VALIDATION),
    onValidationError: (issues) => {
      throw new Error(
        `Invalid environment variables:\n${formatIssues(issues)}`,
      );
    },
  }) as AppEnv<TServer>;
}
