import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

import { formatIssues } from "./config/format-issues";

type ServerShape = Record<string, z.ZodType>;
// Variables the browser also needs must start with NEXT_PUBLIC_ (Next.js inlines them into client
// code at build time).
type ClientShape = Record<`NEXT_PUBLIC_${string}`, z.ZodType>;
type RuntimeEnv = Record<string, string | undefined>;

const nodeEnvSchema = z
  .enum(["development", "test", "production"])
  .default("development");

// createEnv's inference degrades to unknown inside a generic wrapper, so the result type is spelled
// out explicitly here.
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
 * Requires the variable only when `enabled` is true; otherwise it may be left unset.
 * Usage: `OPENAI_API_KEY: requiredWhen(siteConfig.features.ai, z.string().min(1))`.
 */
export function requiredWhen<T extends z.ZodType>(enabled: boolean, schema: T) {
  return enabled ? schema : schema.optional();
}

/**
 * Whether to skip validation. `SKIP_ENV_VALIDATION` only takes effect outside a production runtime:
 * `NODE_ENV` is production in `next build`, `next start`, and Docker, and validation is enforced
 * there — otherwise a single env var on a deployment could skip the required-variable checks, and
 * with them each module's gates (such as "no fake payments in production").
 *
 * Note: the Next CLI fills an unset `NODE_ENV` with the command's default (`next typegen` uses
 * production; see `process.env.NODE_ENV = process.env.NODE_ENV || defaultEnv` in
 * node_modules/next/dist/bin/next:84), so a local command that sets `SKIP_ENV_VALIDATION=1` without
 * `NODE_ENV` is treated as a production runtime. That is why the `pnpm typecheck` script explicitly
 * sets `NODE_ENV=development` — it is a type tool, not a production runtime.
 */
function skipValidation(runtimeEnv: RuntimeEnv) {
  if (runtimeEnv.NODE_ENV === "production") return false;
  return Boolean(runtimeEnv.SKIP_ENV_VALIDATION);
}

/** Validates env vars against the given schema. Throws if any field is invalid, listing each variable name. */
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
