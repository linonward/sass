import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

import { formatIssues } from "./config/format-issues";

type ServerShape = Record<string, z.ZodType>;
// 浏览器也要用的变量，必须以 NEXT_PUBLIC_ 开头（Next.js 构建时内联进客户端代码）。
type ClientShape = Record<`NEXT_PUBLIC_${string}`, z.ZodType>;
type RuntimeEnv = Record<string, string | undefined>;

const nodeEnvSchema = z
  .enum(["development", "test", "production"])
  .default("development");

// createEnv 的推断在泛型包装里会退化成 unknown，这里显式写出结果类型。
type AppEnv<
  TServer extends ServerShape,
  TClient extends ClientShape,
> = Readonly<
  { [K in keyof TServer]: z.output<TServer[K]> } & {
    [K in keyof TClient]: z.output<TClient[K]>;
  } & {
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
export function createAppEnv<
  TServer extends ServerShape,
  TClient extends ClientShape = Record<never, never>,
>({
  server,
  client,
  runtimeEnv,
}: {
  server: TServer;
  client?: TClient;
  runtimeEnv: RuntimeEnv;
}): AppEnv<TServer, TClient> {
  return createEnv({
    shared: { NODE_ENV: nodeEnvSchema },
    server,
    client: client ?? {},
    runtimeEnv,
    emptyStringAsUndefined: true,
    skipValidation: Boolean(runtimeEnv.SKIP_ENV_VALIDATION),
    onValidationError: (issues) => {
      throw new Error(
        `Invalid environment variables:\n${formatIssues(issues)}`,
      );
    },
  }) as AppEnv<TServer, TClient>;
}
