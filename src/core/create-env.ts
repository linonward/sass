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

/**
 * 是否跳过校验。`SKIP_ENV_VALIDATION` 只在非生产运行时生效：
 * `next build`、`next start` 和 Docker 里 `NODE_ENV` 都是 production，此时强制校验 ——
 * 否则部署上一个环境变量就能跳过必填项检查，连带跳过各模块的闸门（比如「生产不允许 fake 支付」）。
 *
 * 注意：Next 的 CLI 会把没设过的 `NODE_ENV` 补成该命令的默认值（`next typegen` 是 production，
 * 见 node_modules/next/dist/bin/next:84 的 `process.env.NODE_ENV = process.env.NODE_ENV || defaultEnv`），
 * 所以只给 `SKIP_ENV_VALIDATION=1` 而不给 `NODE_ENV` 的本地命令会被当成生产运行时。
 * `pnpm typecheck` 因此在脚本里显式带上 `NODE_ENV=development` —— 它是类型工具，不是生产运行时。
 */
function skipValidation(runtimeEnv: RuntimeEnv) {
  if (runtimeEnv.NODE_ENV === "production") return false;
  return Boolean(runtimeEnv.SKIP_ENV_VALIDATION);
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
    skipValidation: skipValidation(runtimeEnv),
    onValidationError: (issues) => {
      throw new Error(
        `Invalid environment variables:\n${formatIssues(issues)}`,
      );
    },
  }) as AppEnv<TServer, TClient>;
}
